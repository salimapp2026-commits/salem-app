// Test 3: MPU6050 motion sensor. Prints total acceleration in g 10 times a second.
// Still on the table: about 1.00. Shake it: jumps above 1.5. Drop it onto a pillow: dips near 0.
#include <Wire.h>
#include "sensors_basic.h"
void setup() {
  Serial.begin(115200); Wire.begin(21, 22);
  Serial.println(MPU6050::begin() ? "MPU6050 OK" : "MPU6050 NOT FOUND (run test 2)");
}
void loop() {
  float g = MPU6050::readG();
  Serial.printf("%.2f g  %s\n", g, g < 0.5 ? "<- free fall" : g > 2.0 ? "<- impact" : "");
  delay(100);
}
