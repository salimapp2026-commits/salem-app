// Test 6: GPS (NEO-6M / NEO-8M). GPS TX -> GPIO16, GPS RX -> GPIO17, VCC 3V3 (or 5V if your
// module has a regulator), GND. Take it outside or next to a window: the first fix can take
// 30 s to a few minutes. The module's own LED starts blinking once it has a fix.
// Type ECHO + Enter to see the raw sentences.
#include "gps_nmea.h"
NmeaParser gps; bool echo = false;
void setup() { Serial.begin(115200); Serial2.begin(9600, SERIAL_8N1, 16, 17); Serial.println("Waiting for GPS..."); }
void loop() {
  while (Serial2.available()) { char c = Serial2.read(); if (echo) Serial.write(c); gps.feed(c); }
  if (Serial.available()) { String s = Serial.readStringUntil('\n'); s.trim(); s.toUpperCase(); echo = (s == "ECHO"); }
  static uint32_t last = 0;
  if (!echo && millis() - last >= 2000) {
    last = millis();
    const GpsFix& f = gps.fix;
    if (f.chars == 0) Serial.println("no data from GPS: swap the TX/RX wires, check power");
    else if (!f.valid) Serial.printf("searching... %d satellites, %lu good sentences\n", f.sats, (unsigned long)f.sentences);
    else Serial.printf("FIX %.6f, %.6f  (%d sats)  https://maps.google.com/?q=%.6f,%.6f\n", f.lat, f.lon, f.sats, f.lat, f.lon);
  }
}
