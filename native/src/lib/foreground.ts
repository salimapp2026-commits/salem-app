// What runs when the app opens or comes back to the front.
//
//   • The Supabase session: refresh while in front, pause in the background
//     (the recommended React Native setup). With persistSession, a beta family
//     stays signed in for weeks; nothing here ever signs anyone out.
//   • The elder's Health Connect sync, at most every 15 minutes.
//   • The elder's time zone, from this phone (founder, 2026-11-01): the elder's own
//     profile is updated only if it changed, and their next doses move with it
//     (set_my_timezone, step32d). Fixes accounts made on a caregiver's phone abroad.
//   • The elder's position for the caregiver's map, every 5 minutes while the app
//     is in front (founder, 2026-11-04; lib/shareLocation).
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { hcSync } from '@/lib/healthConnect';
import { phoneTimezone } from '@/lib/auth';
import { SHARE_EVERY_MS, sharePositionIfDue } from '@/lib/shareLocation';
import { bucketForRole, useAuthStore } from '@/stores/authStore';

const HC_EVERY_MS = 15 * 60_000;
let lastHc = 0;
let tzSent: string | null = null;

function onFront() {
  void supabase.auth.startAutoRefresh();
  const s = useAuthStore.getState();
  const tz = phoneTimezone();
  if (s.session && bucketForRole(s.role) === 'elder' && tz && tz !== tzSent) {
    tzSent = tz;
    void supabase.rpc('set_my_timezone', { p_tz: tz }).then(({ error }) => {
      if (error) tzSent = null;   // try again next time
    });
  }
  if (s.session && bucketForRole(s.role) === 'elder' && Date.now() - lastHc > HC_EVERY_MS) {
    lastHc = Date.now();
    void hcSync().catch(() => {
      lastHc = 0;   // try again next time the app comes to the front
    });
  }
}

export function useForegroundTasks() {
  const role = useAuthStore((s) => s.role);
  const signedIn = useAuthStore((s) => !!s.session);
  useEffect(() => {
    if (AppState.currentState === 'active') onFront();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') onFront();
      else void supabase.auth.stopAutoRefresh();
    });
    return () => sub.remove();
  }, [role, signedIn]);

  // The elder's position: now, then every 5 minutes, only while the app is in front.
  useEffect(() => {
    if (!signedIn || bucketForRole(role) !== 'elder') return;
    const tick = () => {
      if (AppState.currentState === 'active') void sharePositionIfDue();
    };
    tick();
    const timer = setInterval(tick, SHARE_EVERY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [role, signedIn]);
}
