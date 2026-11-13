package com.salem.app

import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale

/**
 * Read-aloud for Rafiq's messages with the phone's own text-to-speech engine. Nothing
 * leaves the phone. Emits "SalemSpeech" with "start" / "done" so the screen can show
 * when it is speaking. speak() resolves false when the engine or the language is not
 * available (the screen says so) — never throws.
 */
class SalemSpeechModule(context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), TextToSpeech.OnInitListener {

  private var tts: TextToSpeech? = null
  private var initDone = false
  private var ready = false
  private val pending = mutableListOf<() -> Unit>()

  override fun getName(): String = "SalemSpeech"

  private fun emit(status: String) {
    if (!reactApplicationContext.hasActiveReactInstance()) return
    reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("SalemSpeech", status)
  }

  override fun onInit(status: Int) {
    synchronized(this) {
      initDone = true
      ready = status == TextToSpeech.SUCCESS
      tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) = emit("start")
        override fun onDone(utteranceId: String?) = emit("done")
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) = emit("done")
        override fun onStop(utteranceId: String?, interrupted: Boolean) = emit("done")
      })
    }
    val run = synchronized(this) { pending.toList().also { pending.clear() } }
    run.forEach { it() }
  }

  @ReactMethod
  fun speak(text: String, lang: String, promise: Promise) {
    val job = {
      val engine = tts
      if (!ready || engine == null) {
        promise.resolve(false)
      } else {
        val locale = if (lang == "ar") Locale("ar", "EG") else Locale.US
        val fallback = if (lang == "ar") Locale("ar") else Locale.ENGLISH
        val use = when {
          engine.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE -> locale
          engine.isLanguageAvailable(fallback) >= TextToSpeech.LANG_AVAILABLE -> fallback
          else -> null
        }
        if (use == null) {
          promise.resolve(false)
        } else {
          engine.language = use
          engine.setSpeechRate(0.9f)
          val r = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "salem-${System.currentTimeMillis()}")
          promise.resolve(r == TextToSpeech.SUCCESS)
        }
      }
    }
    val now = synchronized(this) {
      if (tts == null) tts = TextToSpeech(reactApplicationContext, this)
      if (initDone) true else { pending.add(job); false }
    }
    if (now) job()
  }

  @ReactMethod
  fun stop() {
    tts?.stop()
    emit("done")
  }

  // Required by NativeEventEmitter.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}

  override fun invalidate() {
    tts?.shutdown()
    tts = null
    super.invalidate()
  }
}
