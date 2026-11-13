# Salem without Expo — bare React Native (DECIDED, in progress)

_Decision 2026-10-16 (founder). Supersedes the earlier "keep Expo" plan in
`docs/MOBILE_MIGRATION.md` §1–3 and the pure-Swift/Kotlin option._

## 1. Decision

| | |
|---|---|
| **Approach** | **Plain (bare) React Native**, one TypeScript codebase, built in **Xcode** and **Android Studio**. |
| **Expo** | **Removed completely** — every `expo-*` / `@expo/*` package and the Expo dev server. |
| **Native code** | Where a feature needs it (BLE background mode, background location, push), a **small native module in Swift / Kotlin inside the RN app** — not a rewrite. |
| **Minimum OS** | **iOS 15.1** (React Native's minimum — iPhone 6s / 7 still work), **Android 8 (API 26)**. |
| **Order** | iPhone first (Xcode is ready), but **Android-compatible from day one**; Android is built and tested as soon as Android Studio is installed, not after iPhone. |
| **Current app** | The Expo app — **including the web version** — keeps working, untouched, until the new build matches it **screen for screen**. Removing it (and web) is a **separate final step, only after the founder confirms**. |
| **Backend** | **Not touched**: database, security rules, Rafiq, Trend Watch, band processing, alert pipeline, edge functions. |
| **Secrets** | `.env`, keys and `SUPABASE_DB_URL` never committed. |
| **Branch** | `feature/bare-react-native` (off `feature/band-trend-watch`), small commits. |

## 2. How the two apps live side by side

```
salem-app/
  native/                 NEW bare React Native app (RN 0.81.5, React 19.1)
    ios/  android/        real Xcode / Android Studio projects (committed)
    src/                  screens move here one by one, Expo imports replaced
  app/ components/ lib/   CURRENT Expo app — unchanged, still runs on web/Expo
  supabase/ docs/ scripts/ tests/   unchanged
```

- A screen is ported by moving its code into `native/src/` and replacing its
  Expo imports. The old copy stays until the final removal step.
- Both apps read the same `.env` (public Supabase URL + anon key only), so they
  talk to the same backend.
- Bundle id stays **`com.salem.app`** (iOS and Android).
- At the end (after confirmation): `native/` moves to the repo root, the Expo
  app, `react-native-web` and the web scripts are deleted.

## 3. Replacements for every Expo package

| Expo today | Bare React Native |
|---|---|
| `expo-router` (file routes, 34 files) | **React Navigation** (`@react-navigation/native` + native-stack) |
| `expo-constants` / `EXPO_PUBLIC_*` env | `react-native-dotenv` (Babel) reading the shared `.env` — public keys only |
| `expo-font`, `@expo-google-fonts/*` | Font files (Inter, IBM Plex Sans Arabic) bundled in the app |
| `@expo/vector-icons` (Feather, Ionicons) | `react-native-vector-icons` |
| `expo-localization` | `react-native-localize` |
| `expo-linking` | React Native `Linking` + deep-link config (`salem://`) |
| `expo-image-picker` | `react-native-image-picker` |
| `expo-file-system`, `expo-sharing` (data export) | `react-native-fs` + `react-native-share` |
| `expo-speech` | `react-native-tts` |
| `expo-status-bar` | React Native `StatusBar` |
| `expo-secure-store` | `react-native-keychain` (if needed; the session stays in AsyncStorage as today) |
| Voice recording (web-only today) | `react-native-audio-recorder-player` → same `transcribe-audio` function |
| Push (web push today) | `react-native-onesignal` (native SDKs) — needs APNs key + Firebase |
| Salem Band BLE | `react-native-ble-plx` + **Swift / Kotlin module** for background restore + Android foreground service |
| Background location | **Swift / Kotlin module** (CoreLocation / Fused Location + foreground service) |
| `react-native-web`, `react-dom`, `@expo/metro-runtime`, `react-onesignal` | Not used by the native app; removed with the web version at the very end |

Kept as they are: `@supabase/supabase-js`, `@tanstack/react-query`, `zustand`,
AsyncStorage, `react-native-svg`, reanimated, gesture-handler, screens,
safe-area-context.

## 4. Phases

0. **Scaffold** — bare RN 0.81.5 app in `native/`, iOS 15.1 / API 26, bundle
   id, builds on the iPhone simulator. ✅ first
1. **Foundation** — design tokens + fonts + icons, env, Supabase client, auth
   store, navigation + role routing, i18n (English LTR pinned, Arabic ready).
2. **Auth** — sign-in, sign-up, phone OTP, auth callback, role select.
3. **Elder** — home, SOS, vitals, reminders, prescriptions, Rafiq chat, messages, "Are you OK?".
4. **Family** — dashboard, alerts, circle, visits, location, trends, messages.
5. **Doctor** — patients, patient file, prescribe, visits, alerts.
6. **Shared** — notifications, settings, plans, legal, pair, redeem invite.
7. **Native modules** — push (OneSignal), BLE background, background location.
8. **Parity check** with the founder → **separate step:** delete the Expo app + web.

Android is built after every phase once Android Studio is installed.

## 5. Screen status

Kept up to date in **`docs/NATIVE_SCREEN_STATUS.md`** (every screen: works on
iOS / works on Android / still on old app).
