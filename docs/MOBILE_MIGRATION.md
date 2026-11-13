# Mobile migration — postponed plan

> **Superseded in part (2026-10-16):** the founder decided to remove Expo
> completely and move to **bare React Native** — see `docs/NATIVE_REWRITE_PLAN.md`.
> §1–3 below (keep Expo, `expo prebuild`) no longer apply; §4 (band BLE layer)
> still applies, implemented as native modules inside the bare RN app.


_Written 2026-10-13. Status: **POSTPONED** until there is a machine that can build
for iOS and Android. Do it in one go._

Salem will become mobile-only (iPhone + Android), built locally — no web version,
no Expo push, no EAS. We keep the Expo framework and the `expo-*` libraries.

## 0. Prerequisite — a build machine

Checked on 2026-10-13, this Mac has **none** of these, so nothing in this plan can
start yet:

| Needed | Why |
|---|---|
| **Xcode** (App Store) + iOS Simulator | `npx expo run:ios`, archive for the App Store |
| **CocoaPods** | iOS native dependencies (`sudo gem install cocoapods`) |
| **Android Studio** (includes a JDK + Android SDK + emulator) | `npx expo run:android`, release bundle for Google Play |
| `ANDROID_HOME` set, an emulator image created | running the app locally |

Until then the web version stays exactly as it is, and all testing happens on web.

**Order when the machine is ready:** install the tools → `npx expo prebuild` →
confirm the app starts with `run:android` and `run:ios` → only then remove web
(so there is never a moment when the app can't run anywhere).

## 1. Founder decisions already made (2026-10-13)

- Mobile only. Keep Expo + `expo-*` libraries; do not rewrite the app.
- No Expo hosted services: no Expo push, no EAS Build / Submit / Update.
- Builds are local: `npx expo prebuild`, `npx expo run:android`, `npx expo run:ios`;
  release builds from Android Studio and Xcode.
- All push notifications go through **OneSignal**.
- `.env` is gitignored and has never been committed (checked 2026-10-13).

## 2. The removal list (approved in principle, NOT yet applied)

### a) Web version

| Type | Item | Action |
|---|---|---|
| Dependency | `react-native-web`, `react-dom` | Remove |
| Dependency | `@expo/metro-runtime` | Remove **only if** `npx expo-doctor` says `expo-router` doesn't need it |
| Dependency | `react-onesignal` (web push SDK) | Remove → replaced by native OneSignal (§3) |
| Script | `"web": "expo start --web"` | Remove. `android`/`ios` become `expo run:android` / `expo run:ios`; add `prebuild` |
| Config | `app.json` → `"web"` block, `assets/favicon.png` | Remove |
| Config | `.claude/launch.json` → `expo-web` entry | Remove (keep plain Metro) |
| File | `public/OneSignalSDKWorker.js` | Delete |
| Code | `lib/supabase.ts` | Always AsyncStorage; `detectSessionInUrl: false` |
| Code | `lib/auth.ts` | Redirect always `salem://auth-callback` |
| Code | `app/auth-callback.tsx` | Replace `window.location` parsing with deep-link handling (§3) |
| Code | `app/location.tsx` | Remove the OpenStreetMap iframe + web branch |
| Code | `lib/oneSignal.ts` | Remove web SDK code (§3 replaces it) |
| Code | `lib/useSpeech.ts` | Remove web branch (cloud MP3 via `<audio>`, browser voice) |
| Code | `lib/useVoiceRecorder.ts` | Web-only (MediaRecorder) → replaced by `expo-audio` (§3) |
| Code | `lib/account.ts`, `lib/confirm.ts`, `lib/contactActions.ts`, `components/AnimatedSplash.tsx` | Drop web branches; native code unchanged |
| Hosting | none exists (no Vercel/Netlify/web export) | — |

### b) Expo push

There is **no Expo push anywhere** (no `expo-notifications`, `exp.host`,
`expo-server-sdk`; none of the 7 edge functions; no database function).

| Item | Action |
|---|---|
| `push_tokens.token` column + `UNIQUE(user_id, token)` (intended for Expo tokens; 0 rows use it) | Drop, in a new migration |
| `push_tokens.platform` allows `'web'` | Restrict to `ios`/`android`; delete the web rows (on 2026-10-13: 3 rows, all test accounts' browser subscriptions) |
| `lib/pushTokens.ts` → `expoPushToken` param + `'web'` | Remove |
| `notify-fanout` | No change (OneSignal player IDs only) |

### c) EAS

Nothing in the repo: no `eas.json`, no `expo-updates`, no EAS project ID, no EAS
scripts. Docs only (see d).

Decision still open: commit the generated `android/` and `ios/` folders, or
gitignore them and regenerate from `app.json` (recommended). Release signing
keys must never be committed either way.

### d) Docs

`ENGINEERING.md` (web push row, `public/` worker, `localhost:8081`/Chrome, EAS
section, Expo Go → local build + release steps), `SALEM_MASTER.md`,
`LAUNCH_PLAN.md`, `COSTS.md` (EAS row; not in totals), `SALEM_COMPLETE_GUIDE.md`
(+ PDF and Desktop copy), `.env.example` (Web Push instructions). No README
exists yet — create a short one.

### Outside the list, can go in the same pass

The dormant `agora-token` function and the old call/chat tables.

## 3. Replacements — must land in the same change

Removing web takes these features away from phones unless replaced:

| Feature | Today | Replacement |
|---|---|---|
| **Sign-in links** (password reset, email confirmation) | Web only — the phone app has no handler for `salem://auth-callback` | `expo-linking`: read the incoming URL, `supabase.auth.exchangeCodeForSession` / `setSession`, then the existing recovery form. **Required.** |
| Supabase Auth **Site URL** | `http://localhost:8081` | Dashboard: Site URL + redirect allowlist → `salem://auth-callback` (remove localhost entries) |
| **Push** | Web push only | `react-native-onesignal` + `onesignal-expo-plugin`; same `requestPushPermission`/`logoutOneSignal` call sites; subscription id → `push_tokens`. Needs: Apple Developer account (APNs key), Firebase project (`google-services.json` / FCM), both entered in the OneSignal dashboard. |
| **Voice input** for Rafiq | Web only (MediaRecorder) | `expo-audio` recording → same `transcribe-audio` function; microphone permission strings in `app.json` |
| **Natural voice** (OpenAI read-aloud) | Web only | Play the `tts` MP3 with `expo-audio` on the phone; keep `expo-speech` as the fallback |
| Embedded **live map** | Web only (iframe) | Optional: `react-native-maps` (Android needs a Google Maps key). Until then: "Open in Maps" button. |
| **Position for SOS / falls** | Web only (browser geolocation, `lib/currentPosition.ts`); nothing on the phone records location yet | `expo-location`: (1) in `currentPosition()` so the SOS button attaches the phone's position (`add_sos_location`), and (2) a light foreground location ping (`location_pings`, source `fg`) while the app is open, so band SOS / fall alerts have a recent "last known location". Background pings only if the founder decides so (battery, privacy text). Location permission strings in `app.json`. |

## 4. Then: the Salem Band Bluetooth layer

Everything for the band that does **not** need a phone build is done and
live (2026-10-13):

| Piece | Where |
|---|---|
| Protocol spec v1 | `docs/BAND_PROTOCOL.md` |
| Parser / encoder (pure TS, 45 tests) | `supabase/functions/_shared/bandProtocol.ts`, `tests/bandProtocol.test.ts` |
| Upload preparation (9 tests) | `supabase/functions/_shared/bandUpload.ts`, `tests/bandUpload.test.ts` |
| Server | `band-ingest` edge function; migrations `step27a`–`27f` (tables, rules, falls, watchdog, 90-day purge) |
| Server checks (50, live, undone after) | `scripts/band/checks.sql` via `node scripts/band/run.mjs checks` |
| Simulator (virtual band + phone) | `npm run band:sim -- <scenario>` |
| Screens (web + phone) | `components/band/*` (status card, "Band" tag, "Are you OK?"), family / doctor / elder home, alerts, Settings |

The phone app only has to **feed the same pipe**: BLE bytes →
`decodeRecordsPacket` / `decodeEvent` → POST to `band-ingest` (base64
`packets`, exactly what `scripts/band/simulate.ts` sends) → write the returned
`commands` hex back to the band. Copy the simulator's `upload()`.

The phone side, once builds work:

1. **`react-native-ble-plx`** + its Expo config plugin. iOS: `NSBluetoothAlwaysUsageDescription`,
   `UIBackgroundModes: [bluetooth-central]`. Android 12+: `BLUETOOTH_SCAN`
   (`neverForLocation`), `BLUETOOTH_CONNECT`; older: location permission.
2. **Pairing** in elder Settings ("Connect my Salem Band" — replaces the
   "needs the phone app" line in `BandSection`, `app/settings.tsx`): scan
   filtered to the Salem service UUID only, show the last 4 characters of the
   serial, connect, request MTU 247, `SET_TIME`, read Device Information, then
   `register_band()`. Big buttons, plain steps (a caregiver often does it on
   the elder's phone).
3. **Connection manager**: keep the connection, auto-reconnect with back-off, on
   every (re)connect `SET_TIME` then `SEND_HISTORY(since last received)`.
   Subscribe to Records (notify) and Events (indicate).
4. **Local queue** that survives restarts (`expo-sqlite`): every decoded record
   and event goes in first, is deleted only after `band-ingest` accepts it.
   Upload every 5 minutes, immediately for events.
5. **Android foreground service** ("Salem is connected to your band") — Expo has
   none built in; use `@notifee/react-native` (has an Expo plugin) or a small
   config plugin.
6. **Commands from the phone**: `VIBRATE` (reminder fired, SOS sent, fall
   alert sent), `ACK_EVENT`, `MEASURE_NOW` when `band-ingest` returns
   `needs_confirmation`, `SET_INTERVAL`.
7. **FALL on the phone**: upload the event at once, then open the existing
   "Are you OK?" screen (`components/band/FallCheckOverlay.tsx` — today it
   opens from the server's pending fall, polled every 5 s) without waiting for
   the poll, and vibrate the band. A short press on the band sends
   FALL_CANCELLED, which band-ingest already handles. If the phone is offline,
   the band's own 30-second window still applies and the fall is uploaded
   later (alerts as "Delayed").
8. **Reminders → band vibrate (v1)**: when a medicine-reminder push arrives and
   the band is connected, send `VIBRATE`. v2 firmware: `SET_REMINDERS` so the
   band vibrates on its own.
9. Test on real hardware with the firmware built from `BAND_PROTOCOL.md`;
   run `node scripts/band/run.mjs checks` and the simulator scenarios first so
   any difference is the BLE layer, not the server.
10. Optional: a "Forget band" button for caregivers with manage permission
   (the `forget_band(p_elder_id)` RPC already allows it; only the elder's
   Settings has the button today).
