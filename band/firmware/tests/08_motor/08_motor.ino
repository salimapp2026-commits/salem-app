// Test 8: vibration motor through the 2N2222.
// GPIO25 -> 1k -> transistor base | emitter -> GND | collector -> motor (-) | motor (+) -> 3V3
// 1N4148 across the motor, stripe (cathode) on the motor (+) side.
// Plays the four band patterns in turn: 1 reminder, 2 SOS sent, 3 medicine, 4 fall check.
const int MOTOR = 25;
void buzz(int pulses) {
  for (int i = 0; i < pulses; i++) { digitalWrite(MOTOR, HIGH); delay(250); digitalWrite(MOTOR, LOW); delay(150); }
}
void setup() { Serial.begin(115200); pinMode(MOTOR, OUTPUT); }
void loop() {
  const int pulses[4] = {1, 2, 3, 6};
  for (int p = 0; p < 4; p++) { Serial.printf("pattern %d\n", p + 1); buzz(pulses[p]); delay(1500); }
}
