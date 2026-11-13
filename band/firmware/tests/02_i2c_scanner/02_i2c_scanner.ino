// Test 2: which chips answer on the I2C bus (SDA 21, SCL 22)?
// Expected: 0x48 MAX30205, 0x57 MAX30102, 0x68 MPU6050. Repeats every 5 s.
#include <Wire.h>
void setup() { Serial.begin(115200); Wire.begin(21, 22); }
void loop() {
  int found = 0;
  Serial.println("Scanning...");
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      const char* name = a == 0x48 ? "MAX30205 temperature" : a == 0x57 ? "MAX30102 heart/SpO2"
                       : a == 0x68 ? "MPU6050 motion" : a == 0x69 ? "MPU6050 (AD0 high)" : "unknown";
      Serial.printf("  found 0x%02X  %s\n", a, name); found++;
    }
  }
  if (!found) Serial.println("  nothing found: check 3V3, GND, SDA->21, SCL->22");
  delay(5000);
}
