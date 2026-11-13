package com.salem.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** Salem's own native modules (not autolinked). */
class SalemPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
      listOf(SalemLocationModule(context), SalemAppModule(context), SalemSpeechModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
