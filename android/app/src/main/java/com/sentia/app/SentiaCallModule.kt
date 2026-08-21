package com.sentia.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class SentiaCallModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var telephonyManager: TelephonyManager? = null
    private var phoneStateListener: PhoneStateListener? = null
    private var callStartTime: Long = 0
    private var wasOffhook = false

    override fun getName(): String = "SentiaCall"

    @ReactMethod
    fun placeCall(phoneNumber: String, promise: Promise) {
        try {
            val intent = Intent(Intent.ACTION_CALL)
            intent.data = Uri.parse("tel:$phoneNumber")
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            startWatchingCallState()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CALL_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun stopWatching() {
        stopWatchingCallState()
    }

    // Required by RN's NativeEventEmitter — safe to leave empty.
    @ReactMethod
    fun addListener(eventName: String) {}
    @ReactMethod
    fun removeListeners(count: Int) {}

    private fun sendEvent(eventName: String, params: com.facebook.react.bridge.WritableMap?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    @Suppress("DEPRECATION")
    private fun startWatchingCallState() {
        stopWatchingCallState()
        wasOffhook = false
        callStartTime = 0
        telephonyManager = reactContext.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager

        phoneStateListener = object : PhoneStateListener() {
            override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                val now = System.currentTimeMillis()
                android.util.Log.d("SentiaCall", "onCallStateChanged: state=$state")
                when (state) {
                    TelephonyManager.CALL_STATE_OFFHOOK -> {
                        android.util.Log.d("SentiaCall", "CALL_STATE_OFFHOOK — call is active/connected")
                        wasOffhook = true
                        callStartTime = now
                        val map = Arguments.createMap()
                        map.putString("state", "offhook")
                        sendEvent("onSentiaCallStateChanged", map)
                    }
                    TelephonyManager.CALL_STATE_IDLE -> {
                        if (wasOffhook) {
                            val durationMs = if (callStartTime > 0) now - callStartTime else 0
                            android.util.Log.d("SentiaCall", "CALL_STATE_IDLE — call ended, duration=${durationMs}ms")
                            val map = Arguments.createMap()
                            map.putString("state", "ended")
                            map.putDouble("durationMs", durationMs.toDouble())
                            sendEvent("onSentiaCallStateChanged", map)
                            stopWatchingCallState()
                        }
                    }
                }
            }
        }
        telephonyManager?.listen(phoneStateListener, PhoneStateListener.LISTEN_CALL_STATE)
    }

    private fun stopWatchingCallState() {
        phoneStateListener?.let {
            telephonyManager?.listen(it, PhoneStateListener.LISTEN_NONE)
        }
        phoneStateListener = null
    }
}