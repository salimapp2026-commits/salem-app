package com.salem.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One position for an SOS, while the app is open ("while using the app" only — no background
 * location is declared or requested). Never asks for permission itself: JS asks beforehand, and
 * without it this resolves null. Resolves null rather than failing, and never later than
 * timeoutMs: the SOS has already gone out and must not wait on GPS.
 */
class SalemLocationModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  override fun getName(): String = "SalemLocation"

  @ReactMethod
  fun current(timeoutMs: Double, promise: Promise) {
    val ctx = reactApplicationContext
    val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
    if (!fine && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
      promise.resolve(null)
      return
    }
    val client = LocationServices.getFusedLocationProviderClient(ctx)
    val cancel = CancellationTokenSource()
    val done = AtomicBoolean(false)
    val finish = { loc: Location? ->
      if (done.compareAndSet(false, true)) {
        cancel.cancel()
        promise.resolve(loc?.let { toMap(it) })
      }
    }
    // A fix from the last two minutes is as good as a new one (indoors, GPS may never answer).
    val recentOrNull = {
      try {
        client.lastLocation.addOnCompleteListener { t ->
          val l = if (t.isSuccessful) t.result else null
          finish(l?.takeIf { ageMs(it) <= 120_000 })
        }
      } catch (_: SecurityException) {
        finish(null)
      }
    }
    Handler(Looper.getMainLooper()).postDelayed({ recentOrNull() }, timeoutMs.toLong())
    try {
      val request = CurrentLocationRequest.Builder()
          .setPriority(if (fine) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY)
          .setDurationMillis(timeoutMs.toLong())
          .setMaxUpdateAgeMillis(60_000)
          .build()
      client.getCurrentLocation(request, cancel.token)
          .addOnSuccessListener { loc -> if (loc != null) finish(loc) else recentOrNull() }
          .addOnFailureListener { recentOrNull() }
    } catch (_: SecurityException) {
      finish(null)
    }
  }

  /** This phone's battery, 0–100, sent with each location ping. Needs no permission; null if unknown. */
  @ReactMethod
  fun battery(promise: Promise) {
    val ctx = reactApplicationContext
    val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
    var pct = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
    if (pct !in 0..100) {
      // Some phones don't fill the property; the sticky battery broadcast always has level/scale.
      val i = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      val level = i?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
      val scale = i?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
      pct = if (level >= 0 && scale > 0) Math.round(level * 100f / scale) else -1
    }
    if (pct in 0..100) promise.resolve(pct) else promise.resolve(null)
  }

  private fun granted(p: String) =
      ContextCompat.checkSelfPermission(reactApplicationContext, p) == PackageManager.PERMISSION_GRANTED

  private fun ageMs(l: Location) = (SystemClock.elapsedRealtimeNanos() - l.elapsedRealtimeNanos) / 1_000_000

  private fun toMap(l: Location) = Arguments.createMap().apply {
    putDouble("lat", l.latitude)
    putDouble("lon", l.longitude)
    if (l.hasAccuracy()) putDouble("accuracy_m", l.accuracy.toDouble()) else putNull("accuracy_m")
    putDouble("age_ms", ageMs(l).toDouble())
  }
}
