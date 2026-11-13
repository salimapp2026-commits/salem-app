# Screen status — bare React Native migration

Legend: ✅ works · 🔨 ported + builds, needs a signed-in test · ⏳ in progress ·
— not yet · 🅾️ still available in the old (Expo) app (stays until the founder
confirms parity and asks for the old app/web to be removed)

"Works" means: built natively, opened on the simulator / emulator, signed-out
or signed-in flow exercised against the live backend. Screens behind sign-in
need the founder to sign in on the simulator (no test credentials are used
against the cloud project from here).

Last update: 2026-11-01 — Rafiq chat (row 36) and family linking (rows 33–35) on
Android; elder and caregiver homes rebuilt to the Figma file.

Previous: 2026-10-18 — project moved to `~/Developer/salem-app` (out of
iCloud-synced Documents). All 32 routes ported; the iOS app builds and runs
(iPhone 16 Pro Max simulator, iOS 18.6). Push: native code in progress (see
below). Android: waiting for Android Studio.

| # | Screen (old route) | iOS | Android | Old app |
|---|---|---|---|---|
| 1 | Splash / role funnel (`/`) | ✅ | — | 🅾️ |
| 2 | Sign in (`/(auth)/sign-in`) | ✅ | — | 🅾️ |
| 3 | Sign up (`/(auth)/sign-up`) | ✅ | — | 🅾️ |
| 4 | Phone sign-in / OTP (`/(auth)/phone-sign-in`) | ✅ | — | 🅾️ |
| 5 | Auth callback (reset / confirm link) (`/auth-callback`) | 🔨 | — | 🅾️ |
| 6 | Role select (`/(onboarding)/role-select`) | 🔨 | — | 🅾️ |
| 7 | Elder home (`/(elder)`) — rebuilt to Figma 2026-10-31 | 🔨 | ✅ emulator, test elder (2026-10-31) | 🅾️ |
| 8 | Elder vitals entry (`/(elder)/vitals`) | 🔨 | — | 🅾️ |
| 9 | Elder reminders (`/(elder)/reminders`) | 🔨 | — | 🅾️ |
| 10 | Elder prescriptions (`/(elder)/prescriptions`) | 🔨 | — | 🅾️ |
| 11 | Rafiq insights (`/rafiq`) — status, Day / Week / Month against the person's normal, alert history (Rafiq ML, step 2); preview `/dev/rafiq-preview` | 🔨 builds; needs data from rafiq-score | — | 🔨 same screen |
| 12 | Messages list (`/messages`) | 🔨 | — | 🅾️ |
| 13 | Message thread (`/messages/[id]`) | 🔨 | — | 🅾️ |
| 14 | "Are you OK?" fall overlay | 🔨 | — | 🅾️ |
| 15 | SOS button + confirm | 🔨 | — | 🅾️ |
| 16 | Family dashboard (`/(family)`) — rebuilt to Figma 2026-10-31 | 🔨 | 🔨 design preview only; needs the caregiver signed in | 🅾️ |
| 17 | Family alerts (`/(family)/alerts`) | 🔨 | — | 🅾️ |
| 18 | Care circle + invites (`/(family)/circle`) | 🔨 | — | 🅾️ |
| 19 | Family visits (`/(family)/visits`) | 🔨 | — | 🅾️ |
| 20 | Live location (`/location`) — the elder's app now sends its position every 5 minutes while it is open ("while using the app" permission; founder 2026-11-04); before, only at SOS, so the map was always empty | 🔨 | 🔨 builds; check on the phone + tablet | 🅾️ |
| 21 | Trend Watch (`/trends/[elderId]`) | 🔨 | — | 🅾️ |
| 22 | Doctor patients (`/(doctor)`) | 🔨 | — | 🅾️ |
| 23 | Doctor patient file (`/(doctor)/patient/[id]`) | 🔨 | — | 🅾️ |
| 24 | Doctor prescribe (`/(doctor)/prescribe`) | 🔨 | — | 🅾️ |
| 25 | Doctor new visit (`/(doctor)/visit/new`) | 🔨 | — | 🅾️ |
| 26 | Doctor visit detail (`/(doctor)/visit/[visitId]`) | 🔨 | — | 🅾️ |
| 27 | Doctor alerts (`/(doctor)/alerts`) | 🔨 | — | 🅾️ |
| 28 | Notifications (`/notifications`) | 🔨 | — | 🅾️ |
| 29 | Settings (incl. band section, danger zone) (`/settings`) | 🔨 | — | 🅾️ |
| 30 | Plans (`/plans`) | 🔨 | — | 🅾️ |
| 31 | Privacy policy (`/legal/privacy`) | 🔨 | — | 🅾️ |
| 32 | Terms (`/legal/terms`) | 🔨 | — | 🅾️ |
| 33 | Add a family member (`/link/add`; `/pair` opens it) — typed 4-digit code, Share, 15 min (step32b) | — | 🔨 builds; needs the linking test accounts | 🅾️ |
| 34 | Be invited by a family member (`/link/join`) — type code → who → confirm (step32b) | — | 🔨 builds; needs the linking test accounts | 🅾️ |
| 35 | Redeem an invite token from a link/email (`/redeem-invite`); a 4-digit code is sent to `/link/join` | 🔨 | 🔨 | 🅾️ |
| 36 | Rafiq chat + talk (`/rafiq-chat`, the Rafiq tab for every role) — Figma 05 / 04, own replies, read-aloud | — | ✅ emulator, test elder (2026-10-31); read-aloud audio to check on a real phone | — |
| 37 | Medicine times (`/medicines`) — add a medicine with its daily times, see them, stop one; elder + primary caretaker only (step32i, founder 2026-11-04) | — | ✅ step32i applied 2026-11-04; a medicine added from the tablet, saved and reminding | — |
| — | Dev previews (`/dev/*`) — not ported (development only) | — | — | 🅾️ |

Known gaps vs the old app (to close before parity):
- Rafiq: the old LLM chat and voice messages were removed on purpose (2026-10-22). The
  new chat (row 36, 2026-11-01) is our own rules only, no outside AI; read-aloud uses
  the phone's own text-to-speech; there is no voice input.
- Live location: opens Apple/Google Maps; no in-app map yet.
- Avatar photo: no square-crop step (react-native-image-picker has no editor).
- Push notifications: see **Push** below.
- Sign-in emails: `salem://auth-callback` is already in Supabase Auth's
  redirect allowlist (checked 2026-10-18), so reset/confirm links can open the
  native app.

## Push (OneSignal native SDK)

| | iOS | Android |
|---|---|---|
| App code (sign-in → permission → `push_tokens`; tap → alerts screen) | ✅ builds; SDK starts quietly with no Apple key, no entitlement in the signature (2026-10-18) | ✅ builds (2026-10-18); not yet run on an emulator |
| Tap opens the alerts screen (simulated push, `native/scripts/push-test`) | ⏳ needs the founder signed in as a family account + "Allow" | — |
| Real delivery from `notify-fanout` to a family account | ⛔ blocked: needs a paid Apple Developer account | 🔨 (2026-11-01, 19:49) Firebase connected: the emulator now gets a push token. First reminder test: sent once, to the elder only — but notify-fanout answered `onesignal_configured: false`: the Supabase secrets `ONESIGNAL_APP_ID` / `ONESIGNAL_REST_API_KEY` are missing (step 6 below). |
| Medicine reminders to the elder (step32e + notify-fanout v8): once per dose, Rafiq's voice, Taken / Not yet / Later | — | ✅ on the emulator 2026-11-01: delivered once with the three buttons, logged; **Not yet** → again 15 min later ✅; repeat reminders use a different Rafiq line ✅. **Later** and **Taken** from the push not confirmed: the emulator froze (Mac overloaded, Play services ANR) — check on a real phone (BETA_PHONE_CHECKLIST). |
| Missed dose → ONE push to the primary caretaker (step32f): plain words, normal urgency, never doctors or other family; switch `app_config.reminders.missed_notify_primary`; tap opens the caregiver home | — | 🔨 server + app done and tested (2026-11-01); step32f applied |
| Stopped medicine never "missed" (step32h): its open doses close as skipped, no push to the family | — | ✅ applied (checked 2026-11-08) |
| Add / stop medicines from the app (step32i): `add_medicine`, `stop_medicine`; reminders writable only by the elder and the primary caretaker (was: anyone in the circle, doctors too); a new medicine's next dose is created at once | — | ✅ applied 2026-11-04 (functions + 4 policies checked) |
| Rafiq check-in push + low-mood notice (step32j): 10:00 / 19:00 elder-local hello from Rafiq (quiet 22–08, not if the elder used Rafiq in 3 h, ≤ 3 a day, once per slot, never late; switch `rafiq_chat.checkin_push`, **off** until an APK whose tap opens the chat); "Not good" mood → one plain push a day to primary + family with health permission, never doctors (switch `low_mood_notify`, on) | — | ✅ applied 2026-11-08 (check-in push still off). App: check-in tap opens the Rafiq chat, low-mood tap opens the caregiver home — in the next APK |
| Phone positions deleted after 30 days, each elder's latest kept (step32k): the nightly `location_purge()` | — | ✅ applied 2026-11-08 |
| Elder's setting for the low-mood notice (step32l): `profiles.mood_notify_family` (on); a line under the mood faces says "Not good" tells the family; Settings → Mood toggle | — | ✅ applied 2026-11-08; app in the next APK |
| Newest location of ANY source never deleted (step32m): band fixes got no such check in step32k, so a band-newest elder could end with no position at all | — | ✅ applied 2026-11-08 (bodies checked against the files) |
| Low-mood push: `title_ar` / `body_ar` (notify-fanout's fallback when `texts` is incomplete) carry the Arabic text (step32n); nothing on screen changes today | — | ✅ applied 2026-11-08 (bodies checked against the files) |
| Same Arabic fallback fields for the medicine reminder, missed dose, Rafiq check-in and SOS location follow-up (step32o): each function is its live version (checked byte for byte 2026-11-08) with only those two lines changed; nothing on screen changes today | — | ✅ applied 2026-11-08 (bodies checked against the files) |
| Push log + one account per phone (step32g): notification_log refused `reminder` / `reminder_missed` / `rafiq` rows (silently); one phone was saved for two accounts after a sign-out → sign-in | — | ✅ applied 2026-11-01 (both checks 0) |

How it works: after sign-in the app asks for notification permission and saves
this device's OneSignal subscription id to `push_tokens` — the same table the
web app uses and `notify-fanout` already reads (`include_player_ids`). No
backend change. Only the public App ID is in the app; the OneSignal REST API
key stays a Supabase secret. If OneSignal can't start, or iOS hands out no
push token (free Apple account), the app carries on silently with in-app
notifications — no crash, no error screen, no `push_tokens` row.

**iOS today (free Personal Team):** the default build has **no** Push
Notifications entitlement, so it signs and runs on the simulator and on a real
iPhone with a free account. iOS gives the app no push token, so real pushes
can't arrive yet. `Info.plist` already has background mode
`remote-notification` (allowed on free accounts).

**iOS — turn on once there is a paid Apple Developer account ($99/yr):**
1. Xcode → `native/ios/Salem.xcworkspace` → target **Salem** → *Signing &
   Capabilities* → Team: the paid team.
2. **+ Capability → Push Notifications.** Xcode creates
   `Salem/Salem.entitlements` with `aps-environment` and wires it into the
   build. Commit that file then — not before.
3. developer.apple.com → Certificates, IDs & Profiles → **Keys → +** → enable
   *Apple Push Notifications service (APNs)* → download the `.p8` (only once).
   Note the Key ID and Team ID.
4. OneSignal → the Salem app → Settings → Push & In-App → **Apple iOS (p8)** →
   upload the `.p8`, Key ID, Team ID, bundle id `com.salem.app`. The `.p8` is a
   secret: password manager only, never the repo or the app.
5. Optional, recommended: OneSignal *Notification Service Extension* target
   (delivery receipts, badges, images).
6. Test: sign in as a family account on a real iPhone, trigger an SOS from the
   elder account, confirm the push arrives and opens Family → Alerts.

**Android — Firebase steps (founder does these; the key never comes to the repo):**
1. console.firebase.google.com → **Add project** (e.g. "Salem"); Analytics can
   be off.
2. Project settings (gear) → **Service accounts** → **Generate new private
   key** → a JSON file downloads. This is a secret.
3. OneSignal → the Salem app → Settings → Push & In-App → **Google Android
   (FCM)** → upload that JSON → Save. Then delete the downloaded file (keep a
   copy in the password manager if you want).
4. `google-services.json` is **not needed**: the OneSignal SDK gets the
   Firebase settings from OneSignal. If a build ever asks for it, it will be
   raised with the founder before anything is added or committed.
5. Emulator must be a **Google Play** system image (Google Play services are
   required for FCM).
6. Supabase → Edge Functions → **Secrets**: `ONESIGNAL_APP_ID` (the same public App
   ID the app uses) and `ONESIGNAL_REST_API_KEY` (OneSignal → Settings → **Keys &
   IDs** → App API key, `os_v2_app_…`; notify-fanout v8 accepts it, older versions
   only accept the legacy REST key). Without them notify-fanout answers
   `onesignal_configured: false` and nothing reaches a phone.

## Android build setup (Intel Mac)

- JDK 17: Eclipse Temurin 17.0.20.1 (x86_64) in
  `~/Library/Java/JavaVirtualMachines` (SHA-256 checked against Adoptium's
  published `.sha256.txt`, 2026-10-18). Gradle 8.14.3 can't run on Android
  Studio's bundled JDK 25, which is left alone.
- `native/scripts/android.sh` sets `JAVA_HOME` (JDK 17) and `ANDROID_HOME`
  for that one command only — nothing in the shell profile. Building inside
  Android Studio instead: Settings → Build Tools → Gradle → Gradle JDK → 17.
- Emulator: x86_64 image **with Google Play** (needed for push), API 34/35.
- 2026-10-18: first Android build ✅ (`scripts/android.sh gradle assembleDebug`,
  31 min first time; Gradle fetched API 36 + NDK 27.1 itself). No
  `google-services.json` was needed. Not yet installed: no emulator running.
- Next: install on a Google Play x86_64 emulator, check the signed-out screens,
  then the Firebase → OneSignal setup for the push test.

**Native modules** (no screen): push (OneSignal) ⏳ (code done; delivery tests pending), BLE background —,
background location —.
