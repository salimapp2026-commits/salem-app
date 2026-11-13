// Test 5: MAX30205 body temperature, once a second.
// Room air reads ~25 C. Hold it between two fingers: it climbs toward 33-35 C (skin, not core).
#include <Wire.h>
#include "sensors_basic.h"
void setup() {
  Serial.begin(115200); Wire.begin(21, 22);
  Serial.println(MAX30205::begin() ? "MAX30205 OK" : "MAX30205 NOT FOUND (run test 2; A0-A2 must go to GND for 0x48)");
}
void loop() {
  float c;
  if (MAX30205::readC(c)) Serial.printf("%.2f C\n", c); else Serial.println("no reading");
  delay(1000);
}
