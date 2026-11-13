// Test 9: battery voltage. BAT+ -> 100k -> GPIO34 -> 100k -> GND (the divider halves the voltage,
// so the 4.2 V cell becomes 2.1 V, safe for the ESP32).
// Compare the printed voltage with your multimeter on the 18650. Full ~4.2 V, empty ~3.3 V.
const int PIN_BATT = 34;
void setup() { Serial.begin(115200); analogReadResolution(12); analogSetPinAttenuation(PIN_BATT, ADC_11db); }
void loop() {
  long sum = 0; for (int i = 0; i < 16; i++) sum += analogReadMilliVolts(PIN_BATT);   // average 16 readings
  int mv = sum / 16 * 2;
  int pct = constrain((mv - 3300) * 100 / (4200 - 3300), 0, 100);
  Serial.printf("battery %.2f V  (%d %%)\n", mv / 1000.0, pct);
  delay(1000);
}
