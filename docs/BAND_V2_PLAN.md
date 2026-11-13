# Salem Band v2 — own GPS + 4G — PLAN (not built)

_2026-10-14. Product decision: the production band carries an LTE Cat-1 bis
module with built-in GNSS and a SIM, and talks to Salem directly, with or
without the phone. Bluetooth stays (set-up, and to save power when the phone is
near). The prototype (BLE + NEO-6M) must keep working. Waiting for approval._

## 1. Protocol v2 (`BAND_PROTOCOL.md`)

v1 stays valid: the server accepts v1 and v2 frames, so the prototype keeps
working unchanged until its firmware is updated.

**Framing (v2):** `[version u8 = 0x02][frame type u8][count u8]` + `count` items.

| Frame type | Item | Size |
|---|---|---|
| `0x01` RECORDS | as v1 (type, time, value, quality, flags) | 9 |
| `0x02` EVENTS | as v1 minus the version byte (type, time, data, flags) | 8 |
| `0x03` LOCATIONS | see below | 16 |

**LOCATION item — 16 bytes, little-endian:**

| Offset | Size | Field |
|---|---|---|
| 0 | u32 | time (Unix s) of the fix |
| 4 | i32 | latitude × 10⁷ (30.0444000° → 300444000) |
| 8 | i32 | longitude × 10⁷ |
| 12 | u16 | horizontal accuracy, metres (0xFFFF = unknown) |
| 14 | u8 | fix source: 1 = band GPS, 2 = phone, 3 = cell (reserved) |
| 15 | u8 | flags: bit0 from history, bit1 clock not set, bit2 fix after SOS/FALL |

Validation: lat ±90°, lon ±180°, (0,0) rejected, accuracy > 5 km rejected, same
clock rules as records. Byte examples for MTU 247 / 23 and for an SOS + its
fix will be in the doc and asserted by unit tests, as for v1.

**BLE:** new characteristic `0a2e0006` LOCATIONS (notify), v2 frames. Records
and Events keep their v1 characteristics. New command `0x08 SET_DEVICE_KEY`
(pairing only, §3) and `0x09 SET_HOME` (home zone, §4).

**Cellular (direct):** the band `POST`s **the same binary frames** to
`band-ingest` over HTTPS (TLS 1.2+, CA roots in firmware):

```
POST /functions/v1/band-ingest
Content-Type: application/vnd.salem.band
Authorization: Band <serial>:<device key>
X-Salem-Battery: 64
<frame><frame>…
```

The reply carries the same commands as for the phone (ACK_EVENT, MEASURE_NOW,
VIBRATE) as v2 binary, so the band can clear its log without the phone.

## 2. Device authentication

- At pairing, `register_band()` creates a random **256-bit device key**,
  returns it **once** to the phone app (signed-in elder), and stores only its
  **SHA-256 hash** in `band_devices.device_key_hash`. The phone writes the key
  to the band over BLE (`SET_DEVICE_KEY`, accepted only in pairing mode).
- The band sends it as a bearer value over TLS. The server hashes and compares
  (constant time) in a SECURITY DEFINER function; the column is not readable by
  any app role (column privilege revoked, not just RLS).
- **Never the user's password**, never a user JWT on the band.
- Forget band / re-pair → new key, old one dead at once. Failed attempts are
  rate-limited per serial.
- *Alternative if you prefer:* HMAC-signed requests (key never travels, adds
  replay protection on top of TLS). Costs more firmware work; I recommend the
  bearer key + hash for v1 of v2.

## 3. band-ingest changes

- Two ways in: user JWT (phone, as today) **or** `Authorization: Band …`
  (band). The function then verifies JWTs itself (like analyze-vitals), so
  gateway `verify_jwt` is turned off for it — documented, and covered by tests
  that an unauthenticated / wrong-key call gets 401.
- Accepts JSON (phone, base64 frames) and the binary body (band).
- **Dedup across both paths** is by the band's own clock, so the phone copy and
  the direct copy of the same item collapse into one: records on
  (serial, type, time) — already in place; events on (band, type, time) —
  already in place; locations on (serial, time) — new unique index. Whichever
  copy arrives first counts; the second is acknowledged as a duplicate.
- Locations go only into the protected location table: `location_pings` with
  source `band_gps` / `band_phone` and the band serial; RLS
  `can_read_location` (never doctors). Never in alert payloads or the
  notification log. One audit row per batch, not per fix (like readings).
- Retention: 30 days — already scheduled (step29b covers `source like 'band%'`).

## 4. When the band runs GPS (firmware rules, in the protocol doc)

| Situation | GPS |
|---|---|
| **SOS** | On at once. The SOS is sent immediately **without waiting** for a fix; the fix follows as a LOCATION item (flag bit2) within ~60 s. |
| **Fall** | Same as SOS. |
| **At home** (inside the home zone) | **Off.** |
| **Leaving home / a safe zone** | Detected cheaply first (sustained walking on the accelerometer, or the LTE serving cell changes) → one fix. Outside the zone → "away" mode and an immediate upload. |
| **Away from home** | One fix **every 10 minutes**, uploaded with the readings. Back inside the home zone → off. |

The home zone comes from a safe zone marked **home** and is sent to the band
(`SET_HOME`, also over cellular in the command reply).

## 5. Alerts

- **SOS / fall location:** use whichever is fresher — the band's own GPS fix
  or the phone's last position — and show its **time, accuracy and source** in
  the push and on the alert: "Last known location (10:42, ±12 m, band GPS)".
  `alert_locations` gains `accuracy_m` (already there) + `fix_source`. Works on
  **every plan**.
- **Safe zones (new):** on each band fix, the server checks the elder's active
  zones; crossing out of one → `safe_zone_events` row + an **info** `zone_exit`
  alert to the primary caregiver, fixed text, pushed directly; the location is
  only behind the location permission (never doctors). No repeat until the
  band has been back inside. Proposed: also an info "back inside" event, no push.
- **Plan rules:** live band tracking and safe-zone alerts check
  `has_feature(elder, 'band_location')` (returns true for now). SOS / fall
  location never checks a plan.

## 6. App (web-testable)

- Location screen: show the band's fix when it is fresher than the phone's,
  with source + accuracy (behind `band_location`).
- **Safe-zone editor** for caregivers with manage + location permission
  (create / edit / delete, mark one as home). There is no zone editor in the
  app today — one zone exists in the database from earlier testing.
- Alert screens: "Left safe zone" text and the location link.

## 7. Simulator

- LOCATION items on both paths (`--path ble | cellular | both`; `both` proves
  the dedup).
- `walk-out`: fixes walking from the home zone centre out of it → one zone
  exit alert.
- `phone-at-home`: the phone path is silent; the band uploads directly with
  its device key, walks away, then presses SOS → alert with the band's GPS fix.
- The simulated band's key is issued by `register_band` at `pair` and kept in
  a gitignored local file; the simulator still never uses the service-role key.

## 8. Tests

Unit: v2 framing, LOCATION byte examples, auth header parsing, dedup keys.
Live (undone transaction): device-key auth (right / wrong / forgotten band),
same item via both paths stored once, locations hidden from doctors and
non-permitted caregivers, zone exit once per departure, freshest-fix choice,
plan gating on tracking but not on SOS. Prototype v1 frames still accepted.

## 9. Questions before building

1. Device auth: bearer key + stored hash (recommended) or HMAC signing?
2. Home detection: is "a safe zone marked home" right, and who sets it — the
   primary caregiver only, or anyone with manage permission?
3. Zone exit: info alert to the primary caregiver only (info routing), or to
   all family with location permission?
4. Retention for the **phone's** own location pings is still undecided (only
   band fixes and SOS/fall locations have rules now).
5. The 30-day rule deletes band fixes; should a fix that belongs to a zone-exit
   alert be kept with that alert for 1 year like SOS/fall locations?
