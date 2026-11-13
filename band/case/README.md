# Salem Smart Band: 3D-printed case (ESP32 prototype)

Two parts worn together, joined by a thin cable (6–8 wires):

| Unit | Holds | Size (outer) | Strap |
|---|---|---|---|
| Wrist pod | MAX30102, MAX30205, MPU6050, SOS button, vibration motor | 56 × 42 × 16 mm | 22 mm |
| Control box | ESP32 DevKit, 18650 + 1-slot holder, TP4056, MT3608, NEO-8M GPS | 90 × 88 × 30 mm | 25 mm (upper arm or belt) |

The ESP32 DevKit and the 18650 are too big for one wrist case, so the sensors that must touch
the skin go in the small wrist pod and everything else goes in the box. The final band
(custom board + small flat battery) will be one wrist case.

## Files
- `salem_band_case.scad`: the editable model (OpenSCAD, free). All sizes are at the top.
- `stl/pod_shell.stl`, `stl/pod_back.stl`, `stl/box_base.stl`, `stl/box_lid.stl`: ready to slice.

## Before printing: measure your boards
The board sizes in the .scad file are estimates. Measure each board with calipers, change the
numbers at the top, then export again (set `PART`, press F6, File > Export > STL).
Most important: the MAX30102 board (the Keyestudio one is bigger than the default), the
MAX30205 board, the ESP32 USB position, and the 18650 holder.

## Print settings
PLA or PETG · 0.2 mm layers · 3 walls · 20 % infill · no supports.
Each STL is already placed flat side down. The pod back plate touches skin: PETG is better
against sweat; sand the skin side smooth.

## Assembly
1. Pod back plate: glue the MAX30102 between its corner brackets with the sensor centred in
   the large window, and the MAX30205 over the small window, chip facing the skin.
2. Pod shell: push the tactile button cap through the top hole and glue the switch inside;
   glue the coin motor in its ring; tape the MPU6050 flat inside the top.
3. Run the cable out of the slot at the end, close the pod with 4 × M2 × 6 screws.
4. Box: 18650 holder between the rails, ESP32 with its USB at the right-hand wall, TP4056
   with its USB at the left wall, MT3608 next to it, GPS board in the third row with the
   antenna lying in the square ring under the lid, ceramic side up.
5. Optional 6 mm switch in the round hole to cut battery power.
6. Close with 4 × M3 × 8 screws.
