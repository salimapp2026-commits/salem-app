package com.salem.app

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory
import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Salem"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * react-native-screens can't restore its fragments: when Android recreates the activity (the
   * process was killed in the background, or a language/RTL change), start clean instead of
   * crashing on launch. Signed-in state comes back from storage, not from the saved bundle.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    super.onCreate(null)
    // Health Connect's permission screen reports back through this activity.
    HealthConnectPermissionDelegate.setPermissionDelegate(this)
  }
}
