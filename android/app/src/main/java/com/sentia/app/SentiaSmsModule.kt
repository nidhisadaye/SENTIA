package com.sentia.app

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SentiaSmsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SentiaSms"

    @ReactMethod
    fun sendSms(phoneNumber: String, message: String, promise: Promise) {
        try {
            Log.d("SentiaSms", "sendSms called. to=$phoneNumber, length=${message.length}")

            // Log subscription info purely for diagnosis — helps confirm what the
            // system thinks the active SIM/subscription actually is.
            try {
                val defaultSubId = SubscriptionManager.getDefaultSmsSubscriptionId()
                Log.d("SentiaSms", "System-reported default SMS subscription id: $defaultSubId")
            } catch (e: Exception) {
                Log.w("SentiaSms", "Could not read default SMS subscription id: ${e.message}")
            }

            // IMPORTANT: previously this manually resolved a specific subscription ID
            // via SmsManager.getSmsManagerForSubscriptionId(), intended as a safety net
            // for dual-SIM phones. On real-device testing this was very likely the
            // actual cause of consistent RESULT_RIL_NETWORK_ERR (112) failures — the
            // resolved subscription didn't correctly map to the real active SIM,
            // even on a single-SIM phone. SmsManager.getDefault() lets Android resolve
            // this itself, the same way Google Messages and most other SMS apps do.
            val smsManager: SmsManager = SmsManager.getDefault()
            Log.d("SentiaSms", "Using SmsManager.getDefault()")

            val parts = smsManager.divideMessage(message)
            val totalParts = parts.size
            Log.d("SentiaSms", "Message split into $totalParts part(s)")
            var resultsReceived = 0
            var allSucceeded = true
            var failureReason = ""

            val action = "SENTIA_SMS_SENT_${System.currentTimeMillis()}_${(0..99999).random()}"

            val sentReceiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    resultsReceived++
                    Log.d("SentiaSms", "Broadcast received, resultCode=$resultCode, part $resultsReceived/$totalParts")
                    if (resultCode != Activity.RESULT_OK) {
                        allSucceeded = false
                        failureReason = when (resultCode) {
                            SmsManager.RESULT_ERROR_NO_SERVICE -> "no service"
                            SmsManager.RESULT_ERROR_RADIO_OFF -> "radio off"
                            SmsManager.RESULT_ERROR_NULL_PDU -> "null pdu"
                            SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "generic failure"
                            else -> "unknown failure code ($resultCode)"
                        }
                        Log.w("SentiaSms", "Part failed: $failureReason")
                    }
                    if (resultsReceived == totalParts) {
                        try { reactContext.unregisterReceiver(this) } catch (e: Exception) {}
                        if (allSucceeded) {
                            Log.d("SentiaSms", "All parts confirmed sent successfully")
                            promise.resolve(true)
                        } else {
                            Log.e("SentiaSms", "Reporting failure to JS: $failureReason")
                            promise.reject("SMS_SEND_FAILED", failureReason)
                        }
                    }
                }
            }

            // IMPORTANT: this must be RECEIVER_EXPORTED, not RECEIVER_NOT_EXPORTED.
            // The "SMS sent" confirmation broadcast comes from Android's own system
            // telephony service, not from our own app — NOT_EXPORTED was silently
            // blocking that system broadcast from ever reaching us, which is why
            // every send appeared to "time out" with zero confirmation, regardless
            // of whether the SMS itself actually succeeded or failed.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.registerReceiver(sentReceiver, IntentFilter(action), Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                reactContext.registerReceiver(sentReceiver, IntentFilter(action))
            }

            val sentIntents = ArrayList<PendingIntent>()
            for (i in 0 until totalParts) {
                sentIntents.add(
                    PendingIntent.getBroadcast(
                        reactContext, i, Intent(action),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                )
            }

            try {
                smsManager.sendMultipartTextMessage(phoneNumber, null, parts, sentIntents, null)
                Log.d("SentiaSms", "sendMultipartTextMessage call completed without throwing — waiting for broadcast(s)")
            } catch (e: Exception) {
                Log.e("SentiaSms", "sendMultipartTextMessage THREW immediately: ${e.javaClass.simpleName}: ${e.message}", e)
                try { reactContext.unregisterReceiver(sentReceiver) } catch (ignored: Exception) {}
                promise.reject("SMS_SEND_EXCEPTION", "${e.javaClass.simpleName}: ${e.message}", e)
                return
            }

            Handler(Looper.getMainLooper()).postDelayed({
                if (resultsReceived < totalParts) {
                    Log.w("SentiaSms", "Timeout: only $resultsReceived/$totalParts parts confirmed after 20s")
                    try { reactContext.unregisterReceiver(sentReceiver) } catch (e: Exception) {}
                    promise.reject("SMS_SEND_TIMEOUT", "No confirmation within 20 seconds ($resultsReceived/$totalParts parts confirmed)")
                }
            }, 20000)

        } catch (e: Exception) {
            Log.e("SentiaSms", "sendSms outer catch: ${e.javaClass.simpleName}: ${e.message}", e)
            promise.reject("SMS_SEND_FAILED", e.message, e)
        }
    }
}