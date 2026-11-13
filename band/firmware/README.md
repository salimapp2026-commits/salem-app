# Salem Band firmware, written from scratch

No extra libraries are needed. Every sensor driver was written from the chip datasheets, so the only thing to install is the ESP32 board package.

## Setup (once)
1. Arduino IDE → **Settings** → *Additional boards manager URLs*: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. **Tools → Board → Boards Manager**: search "esp32" and install **esp32 by Espressif Systems**.
3. **Tools → Board**: choose **ESP32 Dev Module**. **Tools → Port**: choose the port that appears when you plug in the board.
4. **Tools → Partition Scheme**: choose **Huge APP (3MB No OTA)**. This only matters for the full firmware, because BLE is large.
5. Open the **Serial Monitor** at **115200** baud.

Board won't upload? Hold the **BOOT** button while "Connecting…" appears.

## Folders
| Folder | What it is |
|---|---|
| `tests/01_blink` … `tests/09_battery` | One small sketch per part. Run them in order while you build the breadboard. |
| `salem_band/` | The full band firmware: BLE protocol v1, vitals, temperature, falls, SOS, GPS, motor, battery. |

Each test folder already holds copies of the driver files it needs, so you can open any one on its own.

| Test | Expect |
|---|---|
| 01_blink | Blue LED blinks; "alive 1, 2, 3…" |
| 02_i2c_scanner | 0x48, 0x57, 0x68 |
| 03_mpu6050 | ~1.00 g still; near 0 when dropped |
| 04_max30102 | HR and SpO2 every 8 s with a still finger. Type `RAW` + Serial Plotter to see the pulse |
| 05_max30205 | ~25 °C in air, rises when held |
| 06_gps | "FIX lat, lon" outdoors (first fix can take minutes). Type `ECHO` to see raw sentences |
| 07_button | "SOS pressed" for each press |
| 08_motor | Four buzz patterns |
| 09_battery | Voltage matching your multimeter (±0.1 V) |

## The driver files (in `salem_band/`)
- `max30102.h`: sets up the heart-rate sensor (25 red + IR readings per second) and reads its FIFO.
- `vitals.h`: computes heart rate and SpO2 from 8 seconds of readings. It removes the slow baseline, finds each beat, and rejects irregular or no-finger windows.
- `gps_nmea.h`: reads the GPS text sentences (RMC for position, GGA for satellites) and checks every checksum.
- `sensors_basic.h`: MPU6050 acceleration (±8 g) and MAX30205 temperature (1/256 °C steps).

## Settings at the top of `salem_band.ino`
- `PIN_MOTOR = 25`: the 2N2222 motor driver. Set it to `2` to blink the blue LED instead.
- `HAS_BATTERY_SENSE = false`: set it to `true` once the battery and the two 100k resistors are wired (map step 8).
- `WORN_IR_ON / WORN_IR_OFF`: the IR level that means "on skin". Read the IR value in test 04 and adjust it.

## Serial commands (full firmware)
`HELP`, `STATUS`, `MEASURE`, `BLOCK`, `FALL`, `VIBRATE 1-4`, `TIME <unix>`, `HISTORY <unix>`, `INTERVAL <min>`, `ACK <unix>`, `HEX <bytes>`

## Honest limits
- The code compiles, and the maths and GPS parser were checked against simulated signals, but it has **not been run on real hardware yet**. Expect to tune thresholds.
- SpO2 uses a general formula and is **not calibrated** for this board. Treat it as indicative, never as a medical reading.
- The MAX30205 measures **skin** temperature, which is a few degrees below core temperature.
- The BLE UUIDs are placeholders. If `docs/BAND_PROTOCOL.md` in the app repo differs, the document wins.
