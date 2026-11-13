// Test 4: MAX30102 heart rate + SpO2. Rest a fingertip on the sensor with light, steady
// pressure and keep still. Every 8 s it prints heart rate and SpO2.
// The raw IR level is printed each second: under 50000 means no finger.
// Open Tools > Serial Plotter and type RAW + Enter to see the pulse wave instead.
#include <Wire.h>
#include "max30102.h"
#include "vitals.h"
uint32_t red[VITALS_N], ir[VITALS_N]; int n = 0; bool raw = false;
void setup() {
  Serial.begin(115200); Wire.begin(21, 22); Wire.setClock(400000);
  if (!MAX30102::begin()) {
    Serial.println("MAX30102 NOT FOUND. Run test 2. Purple boards may need 4.7k pull-ups from SDA/SCL to 3V3.");
    while (true) delay(1000);
  }
  Serial.println("MAX30102 OK. Put your finger on it and keep still.");
}
void loop() {
  if (Serial.available()) { String s = Serial.readStringUntil('\n'); s.trim(); s.toUpperCase(); raw = (s == "RAW"); }
  MAX30102::readFifo([](uint32_t r, uint32_t i) {
    if (raw) Serial.println(i);
    else if (n % 25 == 0) Serial.printf("IR %lu %s\n", (unsigned long)i, i < 50000 ? "(no finger)" : "");
    red[n] = r; ir[n] = i; n++;
  });
  if (n >= VITALS_N) {
    VitalsResult v = computeVitals(red, ir, n); n = 0;
    if (!raw) Serial.printf(">> HR %d bpm %s | SpO2 %d %% %s | %d beats\n", v.hr, v.hrValid ? "(valid)" : "(not reliable)",
                            v.spo2, v.spo2Valid ? "(valid)" : "(not reliable)", v.beats);
  }
  delay(20);
}
