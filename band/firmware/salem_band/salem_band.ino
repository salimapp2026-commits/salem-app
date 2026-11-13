/*
  Salem Smart Band - prototype firmware for ESP32 DevKit (WROOM-32)
  =================================================================
  Real parts, wired as in the "Salem Band Wiring" diagram:

    MAX30102  heart rate + SpO2   I2C 0x57   SDA 21, SCL 22, 3V3
    MAX30205  body temperature    I2C 0x48   same bus
    MPU6050   falls + movement    I2C 0x68   same bus (AD0 open)
    NEO-6M or NEO-8M GPS          UART2      GPS TX -> GPIO16, GPS RX -> GPIO17, 9600 baud
    SOS button                    GPIO27 -> GND (internal pull-up). No button yet? touch a jumper
                                  from GPIO27 to GND: that is a button press.
    Vibration motor               GPIO25 -> 1k -> 2N2222 base; 1N4148 across the motor.
                                  No motor yet? set PIN_MOTOR to 2 (the board's blue LED blinks).
    Battery sense                 GPIO34 <- 100k/100k divider from BAT+.
                                  Running on USB only? set HAS_BATTERY_SENSE to false.

  NO EXTRA LIBRARIES. Every sensor driver is written from the datasheets and lives next to
  this file (the Arduino IDE opens them as tabs):
    max30102.h       heart-rate / SpO2 sensor driver
    vitals.h         heart rate + SpO2 maths
    gps_nmea.h       GPS sentence reader
    sensors_basic.h  MPU6050 motion + MAX30205 body temperature
  BLE and Wire come with the ESP32 board package (Espressif "esp32", 2.x or 3.x).
  Board: "ESP32 Dev Module". Partition scheme: "Huge APP (3MB No OTA)" (BLE is large).

  Protocol v1 (same bytes as the Wokwi test firmware):
    Records  notify    [version u8][count u8] + count x 9-byte record
                       record = [type u8][time u32 LE][value i16 LE][quality u8][flags u8]
                       types: 01 HR bpm, 02 SpO2 %, 03 temp C x100, 04 steps, 05 movement
                       flags: bit0 resting, bit1 on-demand
    Events   indicate  [type u8][time u32 LE][data i16 LE]
                       01 SOS, 02 FALL (peak g x100), 03 OFF_WRIST, 04 ON_WRIST,
                       05 LOW_BATTERY (%), 06 CHARGING, 07 BUTTON_OK
    Commands write     01 SET_TIME u32, 02 VIBRATE u8, 03 ACK_EVENT u32, 04 SEND_HISTORY u32,
                       05 SET_INTERVAL u8 minutes, 06 MEASURE_NOW, 07 SET_REMINDERS (v2, ignored)
    Location notify    PROVISIONAL, align with docs/BAND_PROTOCOL.md before the app uses it:
                       [version u8][reason u8][time u32][lat i32 x1e6][lon i32 x1e6]  (14 bytes)
                       reason: 1 periodic, 2 SOS, 3 FALL
  If docs/BAND_PROTOCOL.md in the app repo differs, the doc wins: change the constants below.

  The Serial Monitor (115200) mirrors everything and accepts the same test commands as the
  Wokwi firmware (type HELP), so the band can be tested before the app connects.
*/

#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "max30102.h"
#include "vitals.h"
#include "gps_nmea.h"
#include "sensors_basic.h"

// ---------------- pins ----------------
const int PIN_SDA = 21, PIN_SCL = 22;
const int PIN_GPS_RX = 16, PIN_GPS_TX = 17;     // ESP32 side: RX2 <- GPS TX, TX2 -> GPS RX
const int PIN_SOS = 27, PIN_MOTOR = 25, PIN_BATT = 34;  // PIN_MOTOR: 25 = motor driver, 2 = on-board LED
const bool HAS_BATTERY_SENSE = false;                     // set true after the battery-reading step (map step 8)

// ---------------- BLE UUIDs (placeholders: must match the app) ----------------
#define UUID_SERVICE  "5a4c0001-8f6a-4b5d-9c3a-53414c454d31"
#define UUID_RECORDS  "5a4c0002-8f6a-4b5d-9c3a-53414c454d31"
#define UUID_EVENTS   "5a4c0003-8f6a-4b5d-9c3a-53414c454d31"
#define UUID_COMMANDS "5a4c0004-8f6a-4b5d-9c3a-53414c454d31"
#define UUID_LOCATION "5a4c0005-8f6a-4b5d-9c3a-53414c454d31"
const char* BLE_NAME = "Salem Band";

// ---------------- protocol v1 ----------------
const uint8_t PROTO_VERSION = 1;
enum : uint8_t { REC_HR = 1, REC_SPO2 = 2, REC_TEMP = 3, REC_STEPS = 4, REC_MOVE = 5 };
enum : uint8_t { EVT_SOS = 1, EVT_FALL = 2, EVT_OFF_WRIST = 3, EVT_ON_WRIST = 4,
                 EVT_LOW_BATTERY = 5, EVT_CHARGING = 6, EVT_BUTTON_OK = 7 };
enum : uint8_t { CMD_SET_TIME = 1, CMD_VIBRATE = 2, CMD_ACK_EVENT = 3, CMD_SEND_HISTORY = 4,
                 CMD_SET_INTERVAL = 5, CMD_MEASURE_NOW = 6, CMD_SET_REMINDERS = 7 };
enum : uint8_t { LOC_PERIODIC = 1, LOC_SOS = 2, LOC_FALL = 3 };
const uint8_t FLAG_RESTING = 0x01, FLAG_ON_DEMAND = 0x02;
const int RECORD_BYTES = 9, EVENT_BYTES = 7;

// ---------------- tuning ----------------
uint32_t sampleMs = 10UL * 60UL * 1000UL;        // one block every 10 minutes (SET_INTERVAL changes it)
const float FREEFALL_G = 0.5f, IMPACT_G = 2.0f, STILL_LO = 0.85f, STILL_HI = 1.15f;
const uint32_t FREEFALL_MIN_MS = 120, IMPACT_WINDOW_MS = 1000, STILL_MS = 2000, AFTER_IMPACT_MAX_MS = 4000;
const uint32_t FALL_CHECK_MS = 30000;            // press within 30 s after a fall = "I'm OK"
const uint32_t WORN_IR_ON = 50000, WORN_IR_OFF = 30000;   // MAX30102 IR level: skin vs air (tune per board)
const int BATT_LOW_PCT = 15;
const uint32_t GPS_MAX_AGE_MS = 120000;          // a fix older than 2 min is not sent

// ---------------- buffers (kept while the phone is away) ----------------
struct Rec { uint8_t type; uint32_t t; int16_t v; uint8_t q; uint8_t flags; };
struct Evt { uint8_t type; uint32_t t; int16_t d; };
const int REC_MAX = 288 * 5;                     // 48 h of 10-minute blocks
const int EVT_MAX = 32;
Rec recBuf[REC_MAX]; int recStart = 0, recCount = 0;
Evt evtBuf[EVT_MAX]; int evtCount = 0;

// ---------------- devices ----------------
bool ppgOk = false, mpuOk = false, tempOk = false;
NmeaParser gps; HardwareSerial& gpsSerial = Serial2;

// ---------------- BLE state ----------------
BLEServer* server = nullptr;
BLECharacteristic *chRecords, *chEvents, *chCommands, *chLocation;
volatile bool bleConnected = false, bleJustConnected = false;
volatile bool cmdPending = false; uint8_t cmdBytes[32]; volatile int cmdLen = 0;
int mtu = 23;

// ---------------- band state ----------------
bool clockSet = false; uint32_t epochAtSet = 0, millisAtSet = 0;
bool worn = false, lowBatterySent = false;
uint32_t lastBlock = 0, fallCheckUntil = 0;
uint8_t motorPattern = 0; uint32_t motorStart = 0;
uint32_t stepCount = 0, moveCount = 0; bool stepHigh = false;
const int WIN = 50; float win[WIN]; int winIdx = 0; bool winFull = false;   // 2 s at 25 Hz
enum FallState { FD_WATCH, FD_FREEFALL, FD_IMPACT } fd = FD_WATCH;
uint32_t fdT = 0, ffStart = 0, stillStart = 0; float fdPeak = 0;

// PPG collection (non-blocking): 200 samples at 25 per second = 8 s
const int PPG_N = VITALS_N;
uint32_t irBuf[PPG_N], redBuf[PPG_N]; int ppgN = 0;
bool ppgCollecting = false, ppgOnDemand = false, ppgMoved = false, sendAfterPpg = false;
uint32_t lastIr = 0;

// functions used before they are written below
void vibrate(uint8_t pattern);
void sendLocation(uint8_t reason);
void finishVitals();

// ================= helpers =================
uint32_t bandTime() {
  if (clockSet) return epochAtSet + (millis() - millisAtSet) / 1000;
  return millis() / 1000;                        // uptime until the phone sends SET_TIME
}
void putU32(uint8_t* p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
void putI32(uint8_t* p, int32_t v) { putU32(p, (uint32_t)v); }
uint32_t getU32(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }
void putI16(uint8_t* p, int16_t v) { p[0] = (uint16_t)v & 0xFF; p[1] = ((uint16_t)v >> 8) & 0xFF; }
void printHex(const uint8_t* b, int n) { for (int i = 0; i < n; i++) Serial.printf("%02X ", b[i]); Serial.println(); }
const char* evtName(uint8_t t) {
  switch (t) { case EVT_SOS: return "SOS"; case EVT_FALL: return "FALL"; case EVT_OFF_WRIST: return "OFF_WRIST";
               case EVT_ON_WRIST: return "ON_WRIST"; case EVT_LOW_BATTERY: return "LOW_BATTERY";
               case EVT_CHARGING: return "CHARGING"; case EVT_BUTTON_OK: return "BUTTON_OK"; } return "?";
}

// ================= MPU6050 + MAX30205 (drivers in sensors_basic.h) =================
void mpuInit() {
  mpuOk = MPU6050::begin();
  Serial.printf("MPU6050 (0x68): %s\n", mpuOk ? "OK" : "NOT FOUND - check SDA/SCL/3V3");
}
float readG() { return mpuOk ? MPU6050::readG() : 1.0f; }
bool isResting() {
  int n = winFull ? WIN : winIdx; if (n < 10) return false;
  float m = 0; for (int i = 0; i < n; i++) m += win[i]; m /= n;
  float v = 0; for (int i = 0; i < n; i++) v += (win[i] - m) * (win[i] - m);
  return sqrtf(v / n) < 0.04f;
}
void tempInit() {
  tempOk = MAX30205::begin();
  Serial.printf("MAX30205 (0x48): %s\n", tempOk ? "OK" : "NOT FOUND - check address pins / wiring");
}
bool readBodyTemp(float& c) { return tempOk && MAX30205::readC(c); }

// ================= MAX30102 =================
void ppgInit() {
  ppgOk = MAX30102::begin();                         // 25 red + IR readings per second
  Serial.printf("MAX30102 (0x57): %s\n", ppgOk ? "OK" : "NOT FOUND - purple boards may need 4.7k pull-ups to 3V3");
}
void startVitals(bool onDemand) {
  if (!ppgOk || !worn) { Serial.println("* vitals skipped: sensor missing or band not worn"); return; }
  ppgN = 0; ppgCollecting = true; ppgOnDemand = onDemand; ppgMoved = false;
  Serial.println("* measuring heart rate + SpO2 (8 s, keep still)");
}

// ================= records =================
void pushRecord(uint8_t type, int16_t v, uint8_t q, uint8_t flags) {
  Rec r = { type, bandTime(), v, q, flags };
  recBuf[(recStart + recCount) % REC_MAX] = r;
  if (recCount < REC_MAX) recCount++; else recStart = (recStart + 1) % REC_MAX;   // drop oldest
}
void sendRecords(uint32_t since) {
  // drop records older than "since" (only when the clock was set, i.e. real epoch times)
  while (recCount > 0 && since > 0 && recBuf[recStart].t > 1000000000UL && recBuf[recStart].t < since) {
    recStart = (recStart + 1) % REC_MAX; recCount--;
  }
  if (!bleConnected || recCount == 0) {
    if (recCount) Serial.printf("* %d records stored, waiting for the phone\n", recCount);
    return;
  }
  int perPacket = (mtu - 3 - 2) / RECORD_BYTES; if (perPacket < 1) perPacket = 1; if (perPacket > 26) perPacket = 26;
  int packets = 0, total = 0;
  while (recCount > 0 && bleConnected) {
    int n = min(perPacket, recCount);
    uint8_t pkt[2 + 26 * RECORD_BYTES];
    pkt[0] = PROTO_VERSION; pkt[1] = n;
    for (int i = 0; i < n; i++) {
      const Rec& r = recBuf[(recStart + i) % REC_MAX]; uint8_t* o = pkt + 2 + i * RECORD_BYTES;
      o[0] = r.type; putU32(o + 1, r.t); putI16(o + 5, r.v); o[7] = r.q; o[8] = r.flags;
    }
    chRecords->setValue(pkt, 2 + n * RECORD_BYTES); chRecords->notify();
    recStart = (recStart + n) % REC_MAX; recCount -= n; packets++; total += n;
    delay(8);                                       // give the BLE stack time between notifications
  }
  Serial.printf("[BLE] sent %d records in %d packets (MTU %d)\n", total, packets, mtu);
}

// ================= events =================
void sendEvent(const Evt& e) {
  uint8_t b[EVENT_BYTES]; b[0] = e.type; putU32(b + 1, e.t); putI16(b + 5, e.d);
  Serial.printf("[EVENT] %s data=%d t=%lu : ", evtName(e.type), e.d, (unsigned long)e.t); printHex(b, EVENT_BYTES);
  if (bleConnected) { chEvents->setValue(b, EVENT_BYTES); chEvents->indicate(); }
}
void pushEvent(uint8_t type, int16_t data) {
  if (evtCount == EVT_MAX) { for (int i = 1; i < EVT_MAX; i++) evtBuf[i - 1] = evtBuf[i]; evtCount--; }
  evtBuf[evtCount] = { type, bandTime(), data };
  sendEvent(evtBuf[evtCount]);                      // kept until the phone ACKs it
  evtCount++;
}
void resendUnackedEvents() { for (int i = 0; i < evtCount; i++) { sendEvent(evtBuf[i]); delay(30); } }
void ackEvent(uint32_t t) {
  for (int i = 0; i < evtCount; i++) if (evtBuf[i].t == t) {
    Serial.printf("* ACK %s, removed\n", evtName(evtBuf[i].type));
    for (int j = i + 1; j < evtCount; j++) evtBuf[j - 1] = evtBuf[j];
    evtCount--; return;
  }
}

// ================= GPS / location =================
void sendLocation(uint8_t reason) {
  const GpsFix& f = gps.fix;
  if (!f.valid || f.ageMs() > GPS_MAX_AGE_MS) {
    Serial.printf("* location (reason %d): no recent GPS fix (satellites %d)\n", reason, f.sats);
    return;
  }
  uint8_t b[14];
  b[0] = PROTO_VERSION; b[1] = reason; putU32(b + 2, bandTime());
  putI32(b + 6, (int32_t)lround(f.lat * 1e6)); putI32(b + 10, (int32_t)lround(f.lon * 1e6));
  Serial.printf("[LOCATION] %.6f, %.6f (reason %d, %d sats)\n", f.lat, f.lon, reason, f.sats);
  if (bleConnected) { chLocation->setValue(b, 14); chLocation->notify(); }
}

// ================= battery =================
int batteryPercent() {
  if (!HAS_BATTERY_SENSE) return 100;               // on USB power: report full, never "low battery"
  int mv = analogReadMilliVolts(PIN_BATT) * 2;      // 100k/100k divider halves the cell voltage
  int pct = (mv - 3300) * 100 / (4200 - 3300);
  return constrain(pct, 0, 100);
}

// ================= motion: fall detector =================
void fallDetector(float g) {
  uint32_t now = millis();
  switch (fd) {
    case FD_WATCH:
      if (g < FREEFALL_G) { if (!ffStart) ffStart = now; if (now - ffStart >= FREEFALL_MIN_MS) { fd = FD_FREEFALL; fdT = now; } }
      else ffStart = 0;
      break;
    case FD_FREEFALL:
      if (g > IMPACT_G) { fd = FD_IMPACT; fdT = now; fdPeak = g; stillStart = 0; }
      else if (now - fdT > IMPACT_WINDOW_MS) { fd = FD_WATCH; ffStart = 0; }
      break;
    case FD_IMPACT:
      if (g > fdPeak) fdPeak = g;
      if (g > STILL_LO && g < STILL_HI) {
        if (!stillStart) stillStart = now;
        if (now - stillStart >= STILL_MS) {
          fd = FD_WATCH; ffStart = 0;
          pushEvent(EVT_FALL, (int16_t)(fdPeak * 100));
          sendLocation(LOC_FALL);
          vibrate(4);                               // "Are you OK?" - a press within 30 s sends BUTTON_OK
        }
      } else stillStart = 0;
      if (fd == FD_IMPACT && now - fdT > AFTER_IMPACT_MAX_MS) { fd = FD_WATCH; ffStart = 0; }
      break;
  }
}

// ================= vibration motor =================
void vibrate(uint8_t pattern) {
  motorPattern = pattern; motorStart = millis();
  if (pattern == 4) fallCheckUntil = millis() + FALL_CHECK_MS;
}
void motorTick() {
  if (!motorPattern) { digitalWrite(PIN_MOTOR, LOW); return; }
  uint32_t e = millis() - motorStart;
  uint8_t pulses = motorPattern == 4 ? 6 : motorPattern;   // 1 reminder, 2 SOS sent, 3 medicine, 4 fall check
  if (e >= pulses * 400UL) { motorPattern = 0; digitalWrite(PIN_MOTOR, LOW); return; }
  digitalWrite(PIN_MOTOR, (e % 400) < 250 ? HIGH : LOW);
}

// ================= measurement block =================
void finishVitals() {
  VitalsResult v = computeVitals(redBuf, irBuf, PPG_N);
  int hr = v.hr, spo2 = v.spo2; bool hrValid = v.hrValid, spo2Valid = v.spo2Valid;
  bool resting = !ppgMoved;
  uint8_t q = (hrValid && spo2Valid) ? 100 : (hrValid || spo2Valid) ? 50 : 0;
  if (!resting) q /= 2;                             // movement spoils the optical signal
  uint8_t flags = (resting ? FLAG_RESTING : 0) | (ppgOnDemand ? FLAG_ON_DEMAND : 0);
  if (hr >= 30 && hr <= 220) pushRecord(REC_HR, hr, hrValid ? q : 0, flags);
  if (spo2 >= 70 && spo2 <= 100) pushRecord(REC_SPO2, spo2, spo2Valid ? q : 0, flags);
  Serial.printf("* vitals: HR %d (%s), SpO2 %d (%s), %d beats, quality %d%s\n", hr, hrValid ? "valid" : "invalid",
                spo2, spo2Valid ? "valid" : "invalid", v.beats, q, resting ? ", resting" : ", moving");
  if (sendAfterPpg || ppgOnDemand) { sendAfterPpg = false; sendRecords(0); }
}
void ppgTick() {
  if (!ppgOk) return;
  bool done = false;
  MAX30102::readFifo([&](uint32_t red, uint32_t ir) {
    lastIr = ir;
    if (ppgCollecting && ppgN < PPG_N) {
      irBuf[ppgN] = ir; redBuf[ppgN] = red;
      if (++ppgN >= PPG_N) { ppgCollecting = false; done = true; }
    }
  });
  if (done) finishVitals();
}
void measurementBlock() {
  int batt = batteryPercent();
  if (batt < BATT_LOW_PCT && !lowBatterySent) { lowBatterySent = true; pushEvent(EVT_LOW_BATTERY, batt); }
  if (batt > BATT_LOW_PCT + 5) lowBatterySent = false;

  uint8_t restFlag = isResting() ? FLAG_RESTING : 0;
  if (worn) {
    float c;
    if (readBodyTemp(c)) pushRecord(REC_TEMP, (int16_t)lround(c * 100), 100, restFlag);
    pushRecord(REC_STEPS, stepCount, 100, restFlag);
    pushRecord(REC_MOVE, moveCount, 100, restFlag);
    sendAfterPpg = true; startVitals(false);        // records go out when the 8 s PPG window ends
  } else {
    sendRecords(0);
  }
  stepCount = 0; moveCount = 0;
  sendLocation(LOC_PERIODIC);
}

// ================= commands (phone -> band) =================
void handleCommandBytes(const uint8_t* b, int n) {
  if (n < 1) return;
  Serial.print("[COMMAND] "); printHex(b, n);
  switch (b[0]) {
    case CMD_SET_TIME:     if (n >= 5) { epochAtSet = getU32(b + 1); millisAtSet = millis(); clockSet = true; Serial.printf("* clock %lu\n", (unsigned long)epochAtSet); } return;
    case CMD_VIBRATE:      if (n >= 2) vibrate(b[1]); return;
    case CMD_ACK_EVENT:    if (n >= 5) ackEvent(getU32(b + 1)); return;
    case CMD_SEND_HISTORY: if (n >= 5) sendRecords(getU32(b + 1)); return;
    case CMD_SET_INTERVAL: if (n >= 2 && b[1]) { sampleMs = b[1] * 60000UL; Serial.printf("* interval %d min\n", b[1]); } return;
    case CMD_MEASURE_NOW:  startVitals(true); return;
    case CMD_SET_REMINDERS: Serial.println("* SET_REMINDERS is v2, ignored"); return;
  }
  Serial.println("* unknown command");
}

// Serial test commands, same as the Wokwi firmware
void handleLine(String line) {
  line.trim(); if (!line.length()) return;
  String up = line; up.toUpperCase();
  int sp = up.indexOf(' ');
  String cmd = sp < 0 ? up : up.substring(0, sp), arg = sp < 0 ? "" : up.substring(sp + 1);
  uint8_t b[32]; int n = 0;
  if (cmd == "TIME")          { b[0] = CMD_SET_TIME; putU32(b + 1, strtoul(arg.c_str(), 0, 10)); n = 5; }
  else if (cmd == "VIBRATE")  { b[0] = CMD_VIBRATE; b[1] = arg.toInt(); n = 2; }
  else if (cmd == "ACK")      { b[0] = CMD_ACK_EVENT; putU32(b + 1, strtoul(arg.c_str(), 0, 10)); n = 5; }
  else if (cmd == "HISTORY")  { b[0] = CMD_SEND_HISTORY; putU32(b + 1, strtoul(arg.c_str(), 0, 10)); n = 5; }
  else if (cmd == "INTERVAL") { b[0] = CMD_SET_INTERVAL; b[1] = arg.toInt(); n = 2; }
  else if (cmd == "MEASURE")  { b[0] = CMD_MEASURE_NOW; n = 1; }
  else if (cmd == "BLOCK")    { measurementBlock(); return; }
  else if (cmd == "FALL")     { pushEvent(EVT_FALL, 310); sendLocation(LOC_FALL); vibrate(4); return; }
  else if (cmd == "HEX") { char* p = (char*)arg.c_str(); while (*p && n < 32) { while (*p == ' ') p++; if (!*p) break; b[n++] = strtoul(p, &p, 16); } }
  else if (cmd == "STATUS") {
    float c = 0; bool tOk = readBodyTemp(c);
    Serial.printf("time %lu%s | BLE %s MTU %d | worn %d (IR %lu) | temp %s%.2f | battery %d%% | resting %d | GPS %s %d sats | stored %d rec, %d evt\n",
      (unsigned long)bandTime(), clockSet ? "" : " (not set)", bleConnected ? "connected" : "advertising", mtu,
      worn, (unsigned long)lastIr, tOk ? "" : "n/a ", c, batteryPercent(), isResting(),
      gps.fix.valid ? "fix" : "no fix", gps.fix.sats, recCount, evtCount);
    return;
  }
  else {
    Serial.println("Commands: TIME <unix> | VIBRATE <1-4> | ACK <unix> | HISTORY <unix> | INTERVAL <min> | MEASURE");
    Serial.println("          BLOCK (run a 10-minute block now) | FALL | HEX <bytes> | STATUS");
    return;
  }
  handleCommandBytes(b, n);
}

// ================= BLE =================
class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override { bleConnected = true; bleJustConnected = true; }
  void onDisconnect(BLEServer* s) override { bleConnected = false; mtu = 23; s->startAdvertising(); }
};
class CommandCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    auto v = c->getValue();                         // String (core 3.x) or std::string (core 2.x)
    int n = min((int)v.length(), (int)sizeof(cmdBytes));
    memcpy(cmdBytes, v.c_str(), n); cmdLen = n; cmdPending = true;   // handled in loop(), not in the BLE task
  }
};
void bleInit() {
  BLEDevice::init(BLE_NAME);
  BLEDevice::setMTU(247);
  server = BLEDevice::createServer();
  server->setCallbacks(new ServerCB());
  BLEService* svc = server->createService(UUID_SERVICE);
  chRecords  = svc->createCharacteristic(UUID_RECORDS,  BLECharacteristic::PROPERTY_NOTIFY);
  chEvents   = svc->createCharacteristic(UUID_EVENTS,   BLECharacteristic::PROPERTY_INDICATE);
  chLocation = svc->createCharacteristic(UUID_LOCATION, BLECharacteristic::PROPERTY_NOTIFY);
  chCommands = svc->createCharacteristic(UUID_COMMANDS, BLECharacteristic::PROPERTY_WRITE);
  chRecords->addDescriptor(new BLE2902()); chEvents->addDescriptor(new BLE2902()); chLocation->addDescriptor(new BLE2902());
  chCommands->setCallbacks(new CommandCB());
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(UUID_SERVICE); adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.printf("BLE advertising as \"%s\"\n", BLE_NAME);
}

// ================= setup / loop =================
void setup() {
  Serial.begin(115200); delay(300);
  Serial.println("\nSalem Smart Band prototype firmware, protocol v1. Type HELP.");
  pinMode(PIN_SOS, INPUT_PULLUP);
  pinMode(PIN_MOTOR, OUTPUT); digitalWrite(PIN_MOTOR, LOW);
  analogReadResolution(12); analogSetPinAttenuation(PIN_BATT, ADC_11db);
  Wire.begin(PIN_SDA, PIN_SCL); Wire.setClock(400000);
  mpuInit(); tempInit(); ppgInit();
  gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.println("GPS on Serial2 at 9600 baud (first fix outdoors can take 30 s to a few minutes)");
  bleInit();
  Serial.printf("Battery %d%%. Clock not set: times are uptime until the phone sends SET_TIME.\n", batteryPercent());
  lastBlock = millis();
}

void loop() {
  static uint32_t lastImu = 0, lastBtn = 0; static bool btnPrev = HIGH; static String line;
  uint32_t now = millis();

  // phone connected: learn the MTU and resend anything not acknowledged
  if (bleJustConnected) {
    bleJustConnected = false; delay(300);
    int m = server->getPeerMTU(server->getConnId()); mtu = (m >= 23 && m <= 517) ? m : 23;
    Serial.printf("[BLE] phone connected, MTU %d. Waiting for SET_TIME and SEND_HISTORY.\n", mtu);
    resendUnackedEvents();
  }
  if (cmdPending) { cmdPending = false; uint8_t b[32]; int n = cmdLen; memcpy(b, cmdBytes, n); handleCommandBytes(b, n); }

  // GPS bytes
  while (gpsSerial.available()) gps.feed((char)gpsSerial.read());

  // optical sensor FIFO + worn detection from the IR level
  ppgTick();
  if (ppgOk) {
    bool w = worn ? (lastIr > WORN_IR_OFF) : (lastIr > WORN_IR_ON);
    if (w != worn) { worn = w; pushEvent(worn ? EVT_ON_WRIST : EVT_OFF_WRIST, 0); if (!worn) ppgCollecting = false; }
  }

  // motion at 25 Hz
  if (now - lastImu >= 40) {
    lastImu = now;
    float g = readG();
    win[winIdx] = g; winIdx = (winIdx + 1) % WIN; if (!winIdx) winFull = true;
    if (fabsf(g - 1.0f) > 0.08f) { moveCount++; if (ppgCollecting) ppgMoved = true; }
    if (g > 1.25f && !stepHigh) { stepHigh = true; stepCount++; } else if (g < 1.1f) stepHigh = false;
    fallDetector(g);                                // runs even if not worn: the SOS path must never depend on "worn"
  }

  // SOS button (debounced, on press)
  bool btn = digitalRead(PIN_SOS);
  if (btn != btnPrev && now - lastBtn > 40) {
    lastBtn = now; btnPrev = btn;
    if (btn == LOW) {
      if (now < fallCheckUntil) { fallCheckUntil = 0; motorPattern = 0; pushEvent(EVT_BUTTON_OK, 0); }
      else { pushEvent(EVT_SOS, 0); sendLocation(LOC_SOS); vibrate(2); }
    }
  }

  // scheduled block
  if (now - lastBlock >= sampleMs) { lastBlock = now; measurementBlock(); }

  motorTick();

  // serial test commands
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') { handleLine(line); line = ""; }
    else if (line.length() < 120) line += ch;
  }
}
