# Salem (سَليم)

Salem is an elderly-care app for families, with a wearable band and a companion
called **Rafiq**. Many older parents in Egypt live alone while their children
work in another city or abroad. Salem lets the family know their parent is
okay, reminds the parent about their medicines, and raises the alarm when
something is wrong.

## Three roles

- **Elder**: a simple home screen with large buttons. SOS, today's medicines,
  Rafiq, and messages to the family.
- **Caregiver** (son, daughter, relative): sees whether the elder is okay, gets
  alerts, sees medicines and readings, and sees location while the elder's app
  is open.
- **Doctor**: sees the health data the family shares and writes prescriptions.
  Doctors never see location.

The role is chosen once and can't be changed. Every permission is enforced in
the database with row-level security, not only in the app.

## Features

- **SOS**: a confirmed press alerts the care circle at once, then adds the
  phone's location.
- **Fall detection**: fall alerts from the Salem Band, with an "Are you okay?"
  step. The band is still a prototype; see Status below.
- **Medicine reminders**: a push to the elder's phone at each dose time with
  **Taken / Not yet / Later**. Not yet and Later remind again, with at most 3
  reminders per dose.
  If a dose is still unconfirmed after the last reminder, the main caregiver
  gets one plain message, never an alarm. The elder and the main caregiver add
  and stop medicines in the app.
- **Family linking by code**: a 4-digit code that works once, for 15 minutes,
  typed on the other person's phone. There is no QR or camera step.
- **Rafiq, daily check-in and chat**: Rafiq says good morning and good evening,
  asks how the elder feels (three faces), reads its messages aloud, and answers
  simple questions from the elder's real data through suggestion buttons. If
  the elder answers "Not good", the family gets one message that day; the elder
  can turn this off. Crisis words show help numbers and alert the family.
- **Rafiq anomaly detection**: Rafiq learns each elder's own normal (a personal
  baseline of median and MAD over past days) and flags what is unusual for
  *that person*. It uses an **Isolation Forest written from scratch** (100
  trees, 20 features) plus simple rules, in Python with numpy for training. The
  model is exported as JSON and scored by a TypeScript port on the server. Tests
  require the two versions to give exactly the same results. Rafiq uses no
  external AI service, LLM or pre-trained model.
- **Health Connect**: reads heart rate, blood oxygen, steps and sleep from
  Android Health Connect.
- **Arabic and right-to-left**: Arabic text and right-to-left layout are built.
  This beta runs in English while the Arabic UI is finished.

## Privacy

- Doctors never see location.
- Caregivers never see the elder's chats with Rafiq. Chats stay on the elder's
  phone; the family only learns the mood the elder taps.
- Rafiq never diagnoses. It says something is unusual compared with the
  person's normal and suggests contacting the doctor. Salem is not a medical
  device.
- Positions shared while the app is open are deleted after 30 days, except the
  most recent one.

## Tech stack

| Part | Built with |
|---|---|
| App | React Native 0.81 (bare, no Expo) + TypeScript; React Navigation, TanStack Query, Zustand |
| Native modules | Kotlin: location, battery, text-to-speech, build flags |
| Backend | Supabase: PostgreSQL with row-level security, Edge Functions (Deno + TypeScript), pg_cron, pg_net |
| Push | OneSignal + Firebase Cloud Messaging |
| Rafiq ML | Python 3 + numpy (training); TypeScript (scoring in production) |
| Health data | Android Health Connect |
| Salem Band | ESP32 (Arduino C++): MAX30102 (heart rate, SpO₂), MAX30205 (skin temperature), MPU6050 (motion, falls), NEO-6M GPS, BLE |
| Band case | OpenSCAD (STL files included) |
| Tests | Vitest + PGlite: the database migrations are tested against a real Postgres engine |

## Repository layout

```
native/               the Android app (React Native + Kotlin)
supabase/migrations/  the database: tables, row-level security, functions, cron jobs
supabase/functions/   Edge Functions: notify-fanout, band-ingest, rafiq-score, trend-watch
ml/                   Rafiq training code (Python + numpy) and reports
band/firmware/        Salem Band firmware (ESP32) and one test sketch per sensor
band/case/            band case in OpenSCAD, with STL files
tests/                app and database tests (Vitest)
docs/                 design notes: band protocol, Rafiq ML plan and results, data retention
```

## Status

A beta with real families in Egypt. **Android only.** The Salem Band is a
working prototype: the firmware, the case and the server path for band data
are built and tested with a simulator, but the beta app does not pair with the
band over Bluetooth yet.

## Download the APK

Get **Salem-0.9.2-beta.apk** from the
[latest release](https://github.com/salimapp2026-commits/salem-app/releases/latest).
The release notes have the SHA-256 checksum and the install steps.

## Team

Adam Gabr, Jowairya Shehab, Seif Hossam
WE School for Applied Technology, Cairo

All rights reserved.
