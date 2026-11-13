// Read-aloud with the phone's own text-to-speech (native SalemSpeech module). Nothing
// leaves the phone; there is no voice input (founder). Missing module (an old build)
// or a missing language → speak() resolves false and the screen says so.
import { useEffect, useState } from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';

type SpeechModule = { speak(text: string, lang: string): Promise<boolean>; stop(): void };
const mod = NativeModules.SalemSpeech as SpeechModule | undefined;
const events = mod ? new NativeEventEmitter(NativeModules.SalemSpeech) : null;

export const speechAvailable = !!mod;

// "Speaking" starts as soon as the phone accepts the text (the engine's own start
// signal can come seconds later the first time) and ends on the engine's done / stop.
const listeners = new Set<(on: boolean) => void>();
const notify = (on: boolean) => listeners.forEach((l) => l(on));
events?.addListener('SalemSpeech', (s: string) => notify(s === 'start'));

export async function speak(text: string, lang: 'ar' | 'en'): Promise<boolean> {
  if (!mod || !text.trim()) return false;
  try {
    const ok = await mod.speak(text, lang);
    if (ok) notify(true);
    return ok;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  mod?.stop();
  notify(false);
}

/** True while the phone is reading something aloud. */
export function useSpeaking(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    listeners.add(setOn);
    return () => { listeners.delete(setOn); };
  }, []);
  return on;
}
