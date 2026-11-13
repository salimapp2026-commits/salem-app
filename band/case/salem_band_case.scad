// Salem Smart Band - 3D-printable case for the ESP32 prototype
// ============================================================
// Two units joined by a thin cable (6-8 wires):
//   WRIST POD    : MAX30102, MAX30205, MPU6050, SOS button, vibration motor.
//                  Sensor windows in the back plate touch the skin. 22 mm strap.
//   CONTROL BOX  : ESP32 DevKit, 18650 in a 1-slot holder, TP4056, MT3608, NEO-8M GPS.
//                  Worn on the upper arm or clipped to a belt with a 25 mm strap.
//                  The GPS antenna sits under the lid, facing up.
//
// Every board size below is an ESTIMATE. Measure your boards with calipers and
// change the numbers before printing. All sizes in mm.
//
// Export one part at a time: set PART below, then F6 (render) and File > Export > STL.
// Print: PLA or PETG, 0.2 mm layers, 3 walls, 20 % infill, no supports
// (each part is already rotated flat side down for printing).

PART = "all";   // "pod_shell", "pod_back", "box_base", "box_lid", "all" (preview)

$fn = 48;
tol = 0.3;           // print clearance

// ---------------- board sizes (MEASURE AND EDIT) ----------------
max30102_board = [20, 15];   // Keyestudio is larger, about [30, 20]: edit to fit
max30205_board = [16, 14];
mpu6050_board  = [21, 16];
motor_d        = 10;         // coin vibration motor
esp32_board    = [55, 28];   // 38-pin DevKit (30-pin is about [51, 28])
holder_18650   = [78, 21, 20];
tp4056_board   = [26, 17];
mt3608_board   = [37, 17];
gps_board      = [36, 26];

// ---------------- wrist pod ----------------
pod_l = 56; pod_w = 42; pod_h = 16;      // outer size
pod_r = 7;  pod_wall = 2; pod_top = 2; pod_back_t = 2.4;
ppg_window  = [11, 7];  ppg_x  = -11;     // MAX30102 optical window (centre offset along length)
temp_window = [7, 7];   temp_x =  14;     // MAX30205 contact window
button_d = 7.2;  button_x = 6;            // hole for a 12x12 tactile switch cap
cable_slot = [8, 4];                       // wire exit at the +x end
strap_pod = 22;                            // strap width

// ---------------- control box ----------------
box_l = 90; box_w = 88; box_h = 30;
box_r = 5;  box_wall = 2.2; box_floor = 2; lid_t = 2;
strap_box = 25;
esp_usb = [13, 8];   // micro-USB opening for the ESP32 (on +x wall)
tp_usb  = [11, 6];   // USB opening for the TP4056 charger (on -x wall)
pod_cable_hole = [10, 6];

// rows inside the box (y centres), matching the layout drawing
row_holder_y = -31.5;  row_esp_y = -4;  row_gps_y = 26;

// ================= helpers =================
module rbox(x, y, z, r) {
  hull() for (i = [-1, 1], j = [-1, 1])
    translate([i * (x / 2 - r), j * (y / 2 - r), 0]) cylinder(r = r, h = z);
}
module strap_loop(len, strap_w, thick = 5) {
  // a loop the strap threads through; slot runs vertically
  difference() {
    translate([0, 0, 0]) rbox(8, strap_w + 8, thick, 2);
    translate([-1.7, -(strap_w + 1) / 2, -1]) cube([3.4, strap_w + 1, thick + 2]);
  }
}

// ================= WRIST POD =================
module pod_shell() {
  h = pod_h - pod_back_t;                  // shell height (back plate closes it)
  difference() {
    union() {
      rbox(pod_l, pod_w, h, pod_r);
      for (s = [-1, 1]) translate([s * (pod_l / 2 + 2), 0, 1]) strap_loop(8, strap_pod);
    }
    // hollow, open at z = 0 (the back plate side)
    translate([0, 0, -0.01]) rbox(pod_l - 2 * pod_wall, pod_w - 2 * pod_wall, h - pod_top, pod_r - pod_wall);
    // SOS button on top
    translate([button_x, 0, h - pod_top - 1]) cylinder(d = button_d, h = pod_top + 2);
    // cable exit
    translate([pod_l / 2 - pod_wall - 1, -cable_slot[0] / 2, -0.01]) cube([pod_wall + 2, cable_slot[0], cable_slot[1]]);
    // "SOS" ring marking around the button (shallow)
    translate([button_x, 0, h - 0.6]) difference() { cylinder(d = button_d + 6, h = 1); cylinder(d = button_d + 3, h = 1); }
  }
  // screw bosses (M2 self-tapping, 6 mm)
  for (i = [-1, 1], j = [-1, 1])
    translate([i * (pod_l / 2 - 5.5), j * (pod_w / 2 - 5.5), 0])
      difference() { cylinder(d = 5, h = h - pod_top); translate([0, 0, -0.01]) cylinder(d = 1.8, h = 7); }
  // motor pocket ring on the inside of the top
  translate([-button_x - 8, 0, h - pod_top - 1.5]) difference() { cylinder(d = motor_d + 3, h = 1.5); translate([0, 0, -0.5]) cylinder(d = motor_d + tol, h = 3); }
}

module pod_back() {
  difference() {
    rbox(pod_l, pod_w, pod_back_t, pod_r);
    // sensor windows
    translate([ppg_x - ppg_window[0] / 2, -ppg_window[1] / 2, -1]) cube([ppg_window[0], ppg_window[1], pod_back_t + 2]);
    translate([temp_x - temp_window[0] / 2, -temp_window[1] / 2, -1]) cube([temp_window[0], temp_window[1], pod_back_t + 2]);
    // screw holes, countersunk on the skin side
    for (i = [-1, 1], j = [-1, 1]) translate([i * (pod_l / 2 - 5.5), j * (pod_w / 2 - 5.5), -1]) {
      cylinder(d = 2.4, h = pod_back_t + 2);
      cylinder(d1 = 4.4, d2 = 2.4, h = 2);
    }
  }
  // locating frames for the two sensor boards (inside face)
  translate([0, 0, pod_back_t]) {
    translate([ppg_x, 0, 0]) frame(max30102_board, 1.2);
    translate([temp_x, 0, 0]) frame(max30205_board, 1.2);
  }
  // inner lip that keys into the shell
  translate([0, 0, pod_back_t]) difference() {
    rbox(pod_l - 2 * pod_wall - 2 * tol, pod_w - 2 * pod_wall - 2 * tol, 1.2, pod_r - pod_wall);
    translate([0, 0, -1]) rbox(pod_l - 2 * pod_wall - 3, pod_w - 2 * pod_wall - 3, 3.4, pod_r - pod_wall - 1);
    for (i = [-1, 1], j = [-1, 1]) translate([i * (pod_l / 2 - 5.5), j * (pod_w / 2 - 5.5), -1]) cylinder(d = 6, h = 4);
  }
}
module frame(sz, h) {
  // L-shaped corner brackets that hold a board over its window
  for (i = [-1, 1], j = [-1, 1]) {
    cx = i * (sz[0] / 2 + tol + 0.75); cy = j * (sz[1] / 2 + tol + 0.75);
    translate([cx - i * 1.25, cy, h / 2]) cube([4, 1.5, h], center = true);
    translate([cx, cy - j * 1.25, h / 2]) cube([1.5, 4, h], center = true);
  }
}

// ================= CONTROL BOX =================
module box_base() {
  h = box_h - lid_t;
  difference() {
    union() {
      rbox(box_l, box_w, h, box_r);
      for (s = [-1, 1]) translate([0, s * (box_w / 2 + 2), 1]) rotate([0, 0, 90]) strap_loop(8, strap_box);
    }
    translate([0, 0, box_floor]) rbox(box_l - 2 * box_wall, box_w - 2 * box_wall, h, box_r - box_wall);
    // ESP32 micro-USB on +x wall
    translate([box_l / 2 - box_wall - 1, row_esp_y - esp_usb[0] / 2, box_floor + 4]) cube([box_wall + 2, esp_usb[0], esp_usb[1]]);
    // TP4056 USB on -x wall (charger sits at the -x end of the ESP32 row)
    translate([-box_l / 2 - 1, row_esp_y - tp_usb[0] / 2, box_floor + 1.5]) cube([box_wall + 2, tp_usb[0], tp_usb[1]]);
    // cable to the wrist pod on -x wall, GPS row
    translate([-box_l / 2 - 1, row_gps_y - pod_cable_hole[0] / 2, h - 10]) cube([box_wall + 2, pod_cable_hole[0], pod_cable_hole[1]]);
    // power switch hole (optional 6 mm toggle/slide) on -x wall, holder row
    translate([-box_l / 2 - 1, row_holder_y, h / 2]) rotate([0, 90, 0]) cylinder(d = 6.2, h = box_wall + 2);
  }
  // lid screw bosses (M3 self-tapping)
  for (i = [-1, 1], j = [-1, 1])
    translate([i * (box_l / 2 - 6), j * (box_w / 2 - 6), 0])
      difference() { cylinder(d = 7, h = h - 0.01); translate([0, 0, 4]) cylinder(d = 2.6, h = h); }
  // low guides that keep the 18650 holder in its row
  for (s = [-1, 1]) translate([0, row_holder_y + s * (holder_18650[1] / 2 + tol + 0.8), box_floor + 2])
    cube([40, 1.6, 4], center = true);
}

module box_lid() {
  difference() {
    union() {
      rbox(box_l, box_w, lid_t, box_r);
      // lip that sits inside the base
      translate([0, 0, lid_t]) difference() {
        rbox(box_l - 2 * box_wall - 2 * tol, box_w - 2 * box_wall - 2 * tol, 2, box_r - box_wall);
        translate([0, 0, -1]) rbox(box_l - 2 * box_wall - 4, box_w - 2 * box_wall - 4, 4, box_r - box_wall - 1);
        for (i = [-1, 1], j = [-1, 1]) translate([i * (box_l / 2 - 6), j * (box_w / 2 - 6), -1]) cylinder(d = 9, h = 4);
      }
      // ring that centres the 25x25 GPS patch antenna under the lid
      // (the lid is flipped over the x axis when fitted, so the GPS row is at -row_gps_y here)
      translate([12 - 14.5, -row_gps_y - 14.5, lid_t]) difference() { cube([29, 29, 1.5]); translate([2, 2, -1]) cube([25, 25, 4]); }
    }
    for (i = [-1, 1], j = [-1, 1]) translate([i * (box_l / 2 - 6), j * (box_w / 2 - 6), -1]) {
      cylinder(d = 3.4, h = lid_t + 2);
      cylinder(d1 = 6.4, d2 = 3.4, h = 1.6);
    }
    // logo-side text, engraved 0.6 mm on the outer face (z = 0 when printed)
    translate([0, 8, -0.01]) mirror([0, 1, 0]) linear_extrude(0.6) text("salem", size = 12, halign = "center", valign = "center", font = "Liberation Sans:style=Bold");
  }
}

// ================= output =================
if (PART == "pod_shell") rotate([180, 0, 0]) pod_shell();          // top face on the bed
else if (PART == "pod_back") pod_back();                           // skin side on the bed
else if (PART == "box_base") box_base();
else if (PART == "box_lid") box_lid();                             // outer face on the bed
else {
  // assembly preview
  translate([0, 0, pod_back_t]) pod_shell();
  translate([0, 0, -12]) color("lightblue") pod_back();
  translate([110, 0, 0]) box_base();
  translate([110, 0, box_h + 12]) rotate([180, 0, 0]) translate([0, 0, -lid_t]) color("lightblue") box_lid();
}
