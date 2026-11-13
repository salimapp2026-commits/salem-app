// MAX30102 heart-rate / SpO2 sensor driver, written from the datasheet. No library needed.
//
// How the chip works: it flashes a red LED and an infrared (IR) LED into the skin and
// measures how much light comes back. Blood absorbs light, so the reading dips a little
// with every heartbeat. The chip stores readings in a 32-slot FIFO (a small queue);
// we read them out over I2C.
#pragma once
#include <Arduino.h>
#include <Wire.h>

namespace MAX30102 {

const uint8_t ADDR = 0x57;

// Register addresses (datasheet, "Register Maps")
const uint8_t REG_FIFO_WR     = 0x04;   // where the chip will write the next sample
const uint8_t REG_FIFO_OVF    = 0x05;   // overflow counter
const uint8_t REG_FIFO_RD     = 0x06;   // where we will read the next sample
const uint8_t REG_FIFO_DATA   = 0x07;   // reading here pops one sample
const uint8_t REG_FIFO_CONFIG = 0x08;
const uint8_t REG_MODE        = 0x09;
const uint8_t REG_SPO2_CONFIG = 0x0A;
const uint8_t REG_LED_RED     = 0x0C;   // red LED current
const uint8_t REG_LED_IR      = 0x0D;   // IR LED current
const uint8_t REG_PART_ID     = 0xFF;   // always 0x15 on a MAX30102

inline bool writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

inline bool readRegs(uint8_t reg, uint8_t* out, uint8_t count) {
  Wire.beginTransmission(ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;       // keep the bus for the read
  if (Wire.requestFrom(ADDR, count) != count) return false;
  for (uint8_t i = 0; i < count; i++) out[i] = Wire.read();
  return true;
}

// Sets the chip up for 25 readings per second of red + IR. Returns false if not found.
inline bool begin(uint8_t ledCurrent = 0x24) {        // 0x24 = about 7 mA per LED
  uint8_t id = 0;
  if (!readRegs(REG_PART_ID, &id, 1) || id != 0x15) return false;
  writeReg(REG_MODE, 0x40);               // reset everything
  delay(10);
  writeReg(REG_FIFO_CONFIG, 0x50);        // average 4 samples (010), FIFO rollover on (1)
  writeReg(REG_SPO2_CONFIG, 0x27);        // range 4096 nA (01), 100 samples/s (001), 18-bit (11)
  writeReg(REG_LED_RED, ledCurrent);
  writeReg(REG_LED_IR, ledCurrent);
  writeReg(REG_FIFO_WR, 0);               // empty the FIFO
  writeReg(REG_FIFO_OVF, 0);
  writeReg(REG_FIFO_RD, 0);
  writeReg(REG_MODE, 0x03);               // SpO2 mode: red and IR LEDs both on
  return true;                            // 100 samples/s averaged by 4 = 25 readings/s
}

// Reads every sample waiting in the FIFO and calls onSample(red, ir) for each one.
// Call it often (every loop); at 25 per second the FIFO fills in about 1.3 s.
template <typename Callback>
inline int readFifo(Callback onSample) {
  uint8_t wr = 0, rd = 0;
  if (!readRegs(REG_FIFO_WR, &wr, 1) || !readRegs(REG_FIFO_RD, &rd, 1)) return 0;
  int waiting = (wr - rd) & 0x1F;         // pointers wrap around at 32
  for (int i = 0; i < waiting; i++) {
    uint8_t b[6];
    if (!readRegs(REG_FIFO_DATA, b, 6)) return i;
    uint32_t red = (((uint32_t)b[0] << 16) | ((uint32_t)b[1] << 8) | b[2]) & 0x3FFFF;   // 18 bits
    uint32_t ir  = (((uint32_t)b[3] << 16) | ((uint32_t)b[4] << 8) | b[5]) & 0x3FFFF;
    onSample(red, ir);
  }
  return waiting;
}

}  // namespace MAX30102
