// MPU6050 (motion) and MAX30205 (body temperature), written from the datasheets.
#pragma once
#include <Arduino.h>
#include <Wire.h>
#include <math.h>

inline bool i2cWrite(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr); Wire.write(reg); Wire.write(val);
  return Wire.endTransmission() == 0;
}
inline bool i2cRead(uint8_t addr, uint8_t reg, uint8_t* out, uint8_t n) {
  Wire.beginTransmission(addr); Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) out[i] = Wire.read();
  return true;
}

// ---------------- MPU6050: accelerometer ----------------
namespace MPU6050 {
const uint8_t ADDR = 0x68;
const float LSB_PER_G = 4096.0f;            // at the +/-8 g range set below

inline bool begin() {
  if (!i2cWrite(ADDR, 0x6B, 0x00)) return false;   // PWR_MGMT_1: wake up (it starts asleep)
  i2cWrite(ADDR, 0x1C, 0x10);                       // ACCEL_CONFIG: +/-8 g, enough for falls
  i2cWrite(ADDR, 0x1A, 0x03);                       // CONFIG: 44 Hz low-pass filter
  return true;
}
// Total acceleration in g. About 1.0 when still (gravity), near 0 while falling.
inline float readG() {
  uint8_t b[6];
  if (!i2cRead(ADDR, 0x3B, b, 6)) return 1.0f;      // ACCEL_XOUT_H .. ACCEL_ZOUT_L
  float x = (int16_t)(b[0] << 8 | b[1]) / LSB_PER_G;
  float y = (int16_t)(b[2] << 8 | b[3]) / LSB_PER_G;
  float z = (int16_t)(b[4] << 8 | b[5]) / LSB_PER_G;
  return sqrtf(x * x + y * y + z * z);
}
}  // namespace MPU6050

// ---------------- MAX30205: body temperature ----------------
namespace MAX30205 {
const uint8_t ADDR = 0x48;                  // A0, A1, A2 tied to GND

inline bool begin() {
  uint8_t b[2];
  return i2cWrite(ADDR, 0x01, 0x00) && i2cRead(ADDR, 0x00, b, 2);   // CONFIG: continuous
}
// Degrees C. Returns false if the read fails or the value is not a skin temperature.
inline bool readC(float& c) {
  uint8_t b[2];
  if (!i2cRead(ADDR, 0x00, b, 2)) return false;
  c = (int16_t)(b[0] << 8 | b[1]) / 256.0f;         // 1 step = 1/256 C
  return c > 20.0f && c < 45.0f;
}
}  // namespace MAX30205
