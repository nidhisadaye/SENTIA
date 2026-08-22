package com.sentia.app

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule

object SentiaVolumeBridge {
    var reactContext: ReactApplicationContext? = null

    fun fireVolumeDownLongPress() {
        android.util.Log.d("SentiaVolume", "fireVolumeDownLongPress called, reactContext is null? ${reactContext == null}")
        reactContext
            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("onVolumeDownLongPress", null)
    }
}