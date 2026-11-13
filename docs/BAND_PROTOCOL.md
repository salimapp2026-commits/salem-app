# Salem Band — Bluetooth protocol, version 1

_The contract the band firmware is built against. Written 2026-10-13._
_Reference implementation: `supabase/functions/_shared/bandProtocol.ts` (the app,
the simulator and the server all use it; its tests check every byte example in
this document)._

## 1. Overview

- Bluetooth Low Energy 5 (ESP32-C3). The band is a **peripheral**; the elder's
  phone is the **central**. One phone per band.
- **All multi-byte numbers are little-endian.**
- **Time** is Unix seconds (UTC), unsigned 32-bit. The band keeps time with its
  own clock, set by the phone with `SET_TIME` on every connection.
- **Version byte.** Every packet in every direction starts with a protocol
  version byte. This document is **version 1 (`0x01`)**. A receiver drops packets
  with a version it doesn't know (the band answers commands with ATT error `0x80`).
- No GPS. Location always comes from the phone. The prototype's GPS module is for
  bench tests only and is never reported.

## 2. Services and characteristics

### Standard Bluetooth SIG services

| Service | Characteristic | Use |
|---|---|---|
| Battery `0x180F` | Battery Level `0x2A19` (read, notify) | 0–100 % |
| Device Information `0x180A` | Serial Number `0x2A25` (read) | e.g. `SB1-000123AB`; the app shows the last 4 characters when pairing |
| | Firmware Revision `0x2A26` (read) | e.g. `1.0.3` |
| | Model Number `0x2A24`, Manufacturer `0x2A29` (read) | `Salem Band`, `Salem` |

### Salem Band service

Base UUID **`0a2eXXXX-a812-4654-9c7b-9ddaccf1dbd4`** (generated for Salem; the
`XXXX` part changes per attribute). The band advertises the service UUID so the
phone can scan for Salem bands only.

| Attribute | UUID | Properties | Content |
|---|---|---|---|
| **Salem Band service** | `0a2e0001-a812-4654-9c7b-9ddaccf1dbd4` | — | — |
| Records | `0a2e0002-a812-4654-9c7b-9ddaccf1dbd4` | notify | measurement packets (§4) |
| Events | `0a2e0003-a812-4654-9c7b-9ddaccf1dbd4` | indicate | one event per indication (§5) |
| Commands | `0a2e0004-a812-4654-9c7b-9ddaccf1dbd4` | write with response | phone → band (§6) |
| Info | `0a2e0005-a812-4654-9c7b-9ddaccf1dbd4` | read | `[version u8][history_hours u8][interval_min u8][capabilities u8]` |

Info capabilities bits: bit0 = supports `MEASURE_NOW`, bit1 = supports
`SET_REMINDERS`. Example (v1 band with both): `01 30 0A 03`
(version 1, 48 h history, 10-minute interval, capabilities `0x03`).

## 3. Packet size (MTU)

- Right after connecting, the phone **requests an MTU of 247**. The usable payload
  is then 244 bytes → **up to 26 records per Records packet** (2 + 26 × 9 = 236).
- If the phone or band refuses, the default MTU is 23 → 20 bytes of payload →
  **2 records per packet** (2 + 2 × 9 = 20).
- Rule for the firmware: `records per packet = floor((MTU − 3 − 2) / 9)`, capped at 26.

## 4. Records (notify)

### Packet

```
[version u8 = 0x01][count u8 = n][record 1 (9 bytes)] … [record n]
```

`count = 0` is the **end-of-history marker** (sent after a `SEND_HISTORY`
replay finishes): `01 00`.

### Record — 9 bytes, fixed

| Offset | Size | Field |
|---|---|---|
| 0 | u8 | type |
| 1 | u32 | time (Unix seconds) — the end of the 30-second measurement, or the end of the 10-minute block |
| 5 | i16 | value, scaled per type (table below) |
| 7 | u8 | quality 0–100 (confidence), or `255` = not applicable |
| 8 | u8 | flags |

Flags: **bit0 = resting** (wearer was still), **bit1 = clock not set**,
**bit2 = from history** (replayed by `SEND_HISTORY`). Bits 3–7 must be 0.

| Type | Name | Value | Scale | Valid range | Quality |
|---|---|---|---|---|---|
| `0x01` | HEART_RATE | beats per minute | ×1 | 25 – 250 | required (0–100) |
| `0x02` | SPO2 | oxygen saturation % | ×1 | 50 – 100 | required (0–100) |
| `0x03` | SKIN_TEMP | °C | ×100 (33.45 °C → 3345) | 20.00 – 45.00 °C | 255 or 0–100 |
| `0x04` | STEPS | steps in the 10-minute block | ×1 | 0 – 3000 | 255 |
| `0x05` | MOVEMENT | movement count in the 10-minute block | ×1 | 0 – 10000 | 255 |

### When the band records

- Every **10 minutes** (configurable with `SET_INTERVAL`): one SKIN_TEMP, one
  STEPS and one MOVEMENT record for the block.
- In the same block, a ~30-second HEART_RATE + SPO2 measurement **only when the
  wearer is still**; those records carry `resting = 1`. A measurement taken
  while moving (e.g. after `MEASURE_NOW`) is sent with `resting = 0`.
- **Nothing is recorded while the band is off the wrist** (between `OFF_WRIST`
  and `ON_WRIST`).
- The band keeps **48 hours** of records in its own memory while the phone is
  out of range, and replays them on `SEND_HISTORY`. Oldest records are
  overwritten first when memory is full.

### Byte examples

Time `0x6ACDE500` = 1791878400 = 2026-10-13 08:00:00 UTC.

**MTU 247 — three records in one packet (29 bytes):**
```
01 03                              version 1, 3 records
01 00 E5 CD 6A 48 00 5C 01         HEART_RATE  08:00:00  72 bpm   q 92  resting
02 1E E5 CD 6A 61 00 58 01         SPO2        08:00:30  97 %     q 88  resting
03 3C E5 CD 6A 11 0D FF 00         SKIN_TEMP   08:01:00  33.45 °C q n/a
```

**MTU 23 fallback — two records (exactly 20 bytes):**
```
01 02
04 00 E5 CD 6A 78 00 FF 00         STEPS     120 steps in the block
05 00 E5 CD 6A 0E 00 FF 00         MOVEMENT  14
```

**A record replayed from history** (06:00, flags `0x05` = resting + from history):
```
01 01  01 E0 C8 CD 6A 46 00 5A 05  HEART_RATE 70 bpm q 90
```

## 5. Events (indicate)

Events are sent the moment they happen, one per indication (BLE indications are
acknowledged by the phone's Bluetooth stack).

### Event — 9 bytes

```
[version u8 = 0x01][type u8][time u32][data i16][flags u8]
```

Flags: bit1 = clock not set, bit2 = from history (same meaning as records).

| Type | Name | Data |
|---|---|---|
| `0x01` | SOS | how long the button was held, in tenths of a second |
| `0x02` | FALL | impact peak in 0.01 g (2.80 g → 280) |
| `0x03` | OFF_WRIST | 0 |
| `0x04` | ON_WRIST | 0 |
| `0x05` | LOW_BATTERY | battery % (sent once when it drops to 20 % and again at 10 %) |
| `0x06` | CHARGING | 1 = started, 0 = stopped |
| `0x07` | FALL_CANCELLED | 0 — the wearer pressed the button during the 30-second fall window |

### The button

- **Press and hold 2 seconds → SOS.** The band vibrates once to confirm it was
  registered, and again (`VIBRATE` from the phone) when the alert was sent.
- After a **FALL**, the band vibrates and opens a **30-second window**: a short
  press in that window sends **FALL_CANCELLED** ("I'm OK"), not SOS.
- A short press outside the fall window does nothing (no accidental SOS).

### Events are never lost

The band keeps an **event log** (at least 64 events or 48 hours) while the phone
is out of range — exactly like records. On reconnection it re-sends every event
the phone hasn't acknowledged, with the from-history flag set. An event is only
removed from the log when the phone sends `ACK_EVENT` for it. **SOS and FALL
events are never overwritten.**

### Byte examples
```
01 02 00 E5 CD 6A 18 01 00         FALL at 08:00:00, peak 2.80 g
01 07 0C E5 CD 6A 00 00 00         FALL_CANCELLED at 08:00:12
01 01 F0 D6 CD 6A 19 00 04         SOS at 07:00:00 (held 2.5 s), replayed from history
01 05 00 E5 CD 6A 0F 00 00         LOW_BATTERY 15 %
```

## 6. Commands (write with response)

```
[version u8 = 0x01][opcode u8][payload …]
```

The band answers with an ATT write response; unknown version or opcode → ATT
error `0x80`, bad payload length → `0x81`.

| Opcode | Command | Payload | Example |
|---|---|---|---|
| `0x01` | SET_TIME | now u32 | `01 01 00 E5 CD 6A` |
| `0x02` | VIBRATE | pattern u8, repeat u8 (patterns: 1 short, 2 double, 3 long, 4 alert sent, 5 reminder) | `01 02 02 01` |
| `0x03` | ACK_EVENT | event type u8, event time u32 | `01 03 02 00 E5 CD 6A` (acknowledge the FALL above) |
| `0x04` | SEND_HISTORY | since u32 — replay every record and unacknowledged event with time > since, then the end-of-history marker | `01 04 00 42 CB 6A` (last 48 h) |
| `0x05` | SET_INTERVAL | minutes u8 (5–60) | `01 05 0A` |
| `0x06` | MEASURE_NOW | bitmask u8: `0x01` HR, `0x02` SpO2, `0x04` skin temperature — take a reading now and notify it | `01 06 03` |
| `0x07` | SET_REMINDERS — **PLANNED, v2 firmware** | count u8 (0–8), then count × [minute of day u16][pattern u8]. Replaces the whole list; count 0 clears it. The band vibrates on its own at those times. | `01 07 02 E0 01 05 CE 04 05` (08:00 and 20:30, reminder pattern) |

A v1 band that doesn't support `SET_REMINDERS` answers `0x80`; the phone checks
the Info capabilities first.

## 7. What the phone does on connect

1. Request MTU 247 (fall back to 2 records per packet).
2. Read Info and Device Information; `SET_TIME`.
3. Subscribe to Records (notify) and Events (indicate).
4. `SEND_HISTORY(since = time of the last record the phone received)`.
5. Upload everything to `band-ingest`; `ACK_EVENT` each event once the server
   accepted it.

## 8. What the server does with the data

Implemented in `band-ingest` and the database (`step27a`/`step27b`). Every number
below is in the `trend_config` table so it can be tuned after the pilot.

| Rule | Setting (default) |
|---|---|
| Readings below the quality threshold are **stored with their quality** but excluded from both the real-time check and Trend Watch (kept to check accuracy in the pilot). Applies to HEART_RATE and SPO2. | `band_quality_min` (60) |
| **15-minute rule.** Age = server time − band time. A reading more than 15 minutes old is stored for Trend Watch but never goes through the real-time check. | `band_realtime_max_age_minutes` (15) |
| A time **in the future** (beyond a 2-minute clock tolerance), or a band whose **clock was never set**, counts as old. | `band_future_tolerance_seconds` (120) |
| A **critical** heart-rate or oxygen alert from the band needs **two good-quality, resting, fresh readings past the critical threshold within 15 minutes** — not one. After the first, `band-ingest` replies `needs_confirmation` (the phone sends `MEASURE_NOW` once it can) and the server **waits up to 15 minutes** for a second reading — the MEASURE_NOW result or simply the next scheduled one: second reading past the same threshold → **critical** alert; second reading normal → no alert, both readings kept; second reading only in the warning range → the normal warning rule; **nothing within 15 minutes → WARNING "Unusual reading, not yet confirmed"** to the caregivers (never dropped). Every confirmed critical goes out — there is no repeat filter on criticals. Thresholds are the same as for manual readings (HR < 45 or > 130, SpO2 < 88). | `band_confirm_window_minutes` (15) |
| **SOS and FALL are never skipped for being old.** A late one still alerts the family, labelled **"Delayed: happened at HH:MM"** with the original time. | — |
| A FALL waits up to 30 seconds for "I'm OK" (band button or the "Are you OK?" screen). No answer → critical fall alert (checked every 30 s, so 30–60 s after the fall reached the server). "Get help" alerts at once. | `band_fall_grace_seconds` (30) |
| Band SOS, fall, low-battery, off-wrist, no-data and "not yet confirmed" alerts are pushed **directly** with fixed text (they never wait for the AI assessment). Band heart-rate / oxygen criticals and warnings go through the same path as manual ones. Manual SOS works the same way since step28a: push first, AI assessment afterwards as an in-app update. | — |
| **SOS and falls carry the last known location** (the phone's last position; the band has no GPS) for people allowed to see location — in the push and as a "Last known location" link on the alert. Never for doctors, never in the alert payload or the notification log, and on **every plan** including FREE (no plan check). | — |
| At most one ordinary band **warning** of the same kind per hour (a band measures every 10 minutes; a manual reading is rare). This limit **never** applies to SOS, falls, confirmed criticals or "not yet confirmed" warnings — those always go out. | `band_warning_repeat_minutes` (60) |
| Only **resting** readings go through the real-time check (110 bpm while walking is normal). | — |
| Band off the wrist more than 2 hours while awake (08:00–22:00 local) → info alert to the primary caretaker. Same for LOW_BATTERY and for no band data for 12 hours. | `band_offwrist_alert_hours` (2), `band_no_data_hours` (12), `band_awake_start_hour` (8), `band_awake_end_hour` (22) |
| Duplicates are dropped on **(band serial, type, time)**. | — |
| Raw band readings are kept **90 days**, then deleted nightly. Daily summaries are kept for good. Manual readings keep today's retention. See `docs/DATA_RETENTION.md`. | `band_raw_retention_days` (90) |
| No per-row audit for band readings; **one audit row per upload batch** (elder, band, rows, time range, accepted / rejected / duplicate counts). | — |

Readings whose clock was never set can't be placed in time, so they are **not
stored** (counted as rejected `clock_not_set`). An SOS or FALL with an unset
clock still alerts, labelled "time unknown".

## 9. Testing without hardware

Nothing below needs a band or a phone build.

| What | Command | Touches live data? |
|---|---|---|
| Parser + upload unit tests (every byte example in this file) | `npm test` | No |
| 50 server checks: rules, falls, SOS, permissions, retention | `node scripts/band/run.mjs checks` (needs `SUPABASE_DB_URL`) | No — runs inside a transaction that is undone |
| Simulator: a virtual band + the phone's upload loop | `npm run band:sim -- <scenario>` | Yes — the TEST elder only |
| The screens with sample data | `npx expo start --web` → `/dev/band-preview` | No |

**Simulator setup (once):**

1. In `.env`: `SUPABASE_DB_URL=…` and `TEST_ELDER_PASSWORD=` (any 12+ characters).
2. `node scripts/trend-watch/run.mjs seed --confirm` — creates the test elder
   `test-account@salem.test`, a caregiver with read-health, one without, and
   a doctor (skip if they already exist).
3. `node scripts/band/run.mjs set-password --confirm` — sets the test elder's
   password from `TEST_ELDER_PASSWORD`.
4. `npm run band:sim -- pair`

The simulator signs in with the **public key + that password**, exactly like
the app. It never reads the service-role key, and refuses any account that
isn't `@salem.test`.

**Scenarios:** `normal`, `offline` (30 h then history sync, with a late SOS →
"Delayed"), `sos`, `fall-cancel`, `fall-wait` (answer "Are you OK?" in the elder
app on web), `fall-noanswer`, `critical` (MEASURE_NOW round trip),
`low-battery`, `off-wrist`, `on-wrist`, `status`, `forget`. Add `--mtu 23` to use
the 2-records-per-packet fallback.

**Clean up:** `node scripts/trend-watch/run.mjs cleanup --confirm` deletes only
the test users' rows (band devices, band events, readings, alerts included) and
prints counts first.
