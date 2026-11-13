package com.salem.app

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

/** Build facts JS needs: the installed version (for the "new version available" prompt) and
 *  whether this is an emulator test build (sample Health Connect readings). */
class SalemAppModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  override fun getName(): String = "SalemApp"

  override fun getConstants(): Map<String, Any> = mapOf(
      "versionCode" to BuildConfig.VERSION_CODE,
      "versionName" to BuildConfig.VERSION_NAME,
      "testTools" to BuildConfig.SALEM_TEST_TOOLS,
  )
}
