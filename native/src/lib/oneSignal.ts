// Push notifications — OneSignal native SDK (iOS + Android).
//
// Same function names as the web app's lib/oneSignal.ts, so the auth store
// calls them the same way:
//   1. initOneSignal()             — once at app start (App.tsx), so a tap on
//      a push that launched the app is not missed. No prompt yet.
//   2. requestPushPermission(uid)  — after sign-in: ties this device to the
//      user (OneSignal external_id), asks for notification permission, then
//      saves the device's subscription id to push_tokens. notify-fanout sends
//      to those ids (include_player_ids), so nothing changes server-side.
//   3. logoutOneSignal()           — on sign-out, so the next user starts clean.
//
// Only the public OneSignal App ID is in the app (EXPO_PUBLIC_ONESIGNAL_APP_ID
// in .env). The REST API key stays a Supabase secret used by notify-fanout.
// If the App ID is missing these helpers do nothing, and alerts still arrive
// as in-app notifications.
//
// Fails quietly: every SDK call is wrapped, nothing is shown to the user, and
// a device is only saved to push_tokens once it has a real push token. On an
// iPhone built without the Push Notifications entitlement (free Apple
// account) iOS never hands out a token, so no row is written and the app
// carries on with in-app notifications. See docs/NATIVE_SCREEN_STATUS.md.
import { OneSignal, type NotificationClickEvent } from 'react-native-onesignal';
import { EXPO_PUBLIC_ONESIGNAL_APP_ID } from '@env';
import { registerPushToken } from '@/lib/pushTokens';
import { supabase } from '@/lib/supabase';

const APP_ID = EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '';

export type PushOpenData = {
  elder_id?: string;
  severity?: string;
  source_kind?: string;
  source_id?: string;
  location_url?: string;
  event_id?: number | string;      // medicine reminders (step32e)
  kind?: string;                   // Rafiq pushes (step32j): 'checkin' | 'low_mood'
};

let initialized = false;
let currentUserId: string | null = null;
let openHandler: ((data: PushOpenData, actionId: string | null) => void) | null = null;

export function isOneSignalConfigured(): boolean {
  return APP_ID.length > 0;
}

/** Called when the user taps a push or one of its buttons (actionId: Taken / Not yet /
 *  Later on a medicine reminder). App.tsx decides what to do. */
export function onPushOpened(handler: (data: PushOpenData, actionId: string | null) => void) {
  openHandler = handler;
}

function quiet(msg: string, e?: unknown) {
  if (__DEV__) console.log(`[salem] ${msg}`, e ?? '');
}

async function saveSubscription(id: string | null | undefined, token: string | null | undefined) {
  if (!id || !token || !currentUserId) return;
  await registerPushToken({ userId: currentUserId, oneSignalPlayerId: id });
}

// Idempotent. Returns true once the SDK is initialised.
export async function initOneSignal(): Promise<boolean> {
  if (!isOneSignalConfigured()) return false;
  if (initialized) return true;
  try {
    OneSignal.initialize(APP_ID);
    // The subscription id can arrive after the permission prompt (iOS waits
    // for the APNs token, Android for FCM), so also save it when it changes.
    OneSignal.User.pushSubscription.addEventListener('change', (e) => {
      void saveSubscription(e.current.id, e.current.token);
    });
    OneSignal.Notifications.addEventListener('click', (e: NotificationClickEvent) => {
      openHandler?.((e.notification.additionalData ?? {}) as PushOpenData, e.result?.actionId ?? null);
    });
    initialized = true;
    return true;
  } catch (e) {
    quiet('OneSignal init failed', e);
    return false;
  }
}

// Safe to call on every sign-in.
export async function requestPushPermission(userId: string): Promise<void> {
  if (!(await initOneSignal())) return;
  currentUserId = userId;
  try {
    OneSignal.login(userId);
    // Android 12 and older grant this without a prompt; iOS and Android 13+
    // show the system prompt once. A refusal is final until the user changes
    // it in Settings, so we don't nag.
    const granted = await OneSignal.Notifications.requestPermission(false);
    if (!granted) return;
    const sub = OneSignal.User.pushSubscription;
    await saveSubscription(await sub.getIdAsync(), await sub.getTokenAsync());
  } catch (e) {
    quiet('push permission flow failed', e);
  }
}

// Before signing out: this phone stops receiving the account's pushes (step32g also
// moves the phone to whoever signs in next). Best-effort — sign-out never waits on it
// failing.
export async function forgetThisDevice(): Promise<void> {
  if (!initialized || !currentUserId) return;
  try {
    const id = await OneSignal.User.pushSubscription.getIdAsync();
    if (id) await supabase.from('push_tokens').delete().eq('user_id', currentUserId).eq('onesignal_player_id', id);
  } catch (e) {
    quiet('forget device failed', e);
  }
}

export async function logoutOneSignal(): Promise<void> {
  currentUserId = null;
  if (!initialized) return;
  try {
    OneSignal.logout();
  } catch {
    // best-effort
  }
}
