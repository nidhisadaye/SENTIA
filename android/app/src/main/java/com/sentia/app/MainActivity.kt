package com.sentia.app
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
    private val volumeHandler = Handler(Looper.getMainLooper())
    private var volumeLongPressTriggered = false
    private val volumeLongPressRunnable = Runnable {
        volumeLongPressTriggered = true
        try {
            val freshContext = (application as MainApplication).reactHost.currentReactContext
                    as? com.facebook.react.bridge.ReactApplicationContext
            android.util.Log.d("SentiaVolume", "Fetched context at press-time, is null? ${freshContext == null}")
            SentiaVolumeBridge.reactContext = freshContext
            SentiaVolumeBridge.fireVolumeDownLongPress()
        } catch (e: Exception) {
            android.util.Log.w("SentiaVolume", "Failed to fire volume long press", e)
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            android.util.Log.d("SentiaVolume", "dispatchKeyEvent received: action=${event.action}, repeatCount=${event.repeatCount}")
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                volumeLongPressTriggered = false
                volumeHandler.postDelayed(volumeLongPressRunnable, 2000) // hold for 2 seconds
                return true
            }
            if (event.action == KeyEvent.ACTION_UP) {
                android.util.Log.d("SentiaVolume", "ACTION_UP received — was held for less than 2s if runnable gets cancelled")
                volumeHandler.removeCallbacks(volumeLongPressRunnable)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Set the theme to AppTheme BEFORE onCreate to support
        // coloring the background, status bar, and navigation bar.
        // This is required for expo-splash-screen.
        // setTheme(R.style.AppTheme);
        // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
        SplashScreenManager.registerOnActivity(this)
        // @generated end expo-splashscreen
        super.onCreate(null)
    }

    /**
     * Returns the name of the main component registered from JavaScript. This is used to schedule
     * rendering of the component.
     */
    override fun getMainComponentName(): String = "main"

    /**
     * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
     * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
     */
    override fun createReactActivityDelegate(): ReactActivityDelegate {
        return ReactActivityDelegateWrapper(
            this,
            BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
            object : DefaultReactActivityDelegate(
                this,
                mainComponentName,
                fabricEnabled
            ){})
    }

    /**
     * Align the back button behavior with Android S
     * where moving root activities to background instead of finishing activities.
     * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
     */
    override fun invokeDefaultOnBackPressed() {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
            if (!moveTaskToBack(false)) {
                // For non-root activities, use the default implementation to finish them.
                super.invokeDefaultOnBackPressed()
            }
            return
        }

        // Use the default back button implementation on Android S
        // because it's doing more than [Activity.moveTaskToBack] in fact.
        super.invokeDefaultOnBackPressed()
    }
}