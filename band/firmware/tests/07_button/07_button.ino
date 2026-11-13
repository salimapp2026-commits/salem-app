// Test 7: SOS button. One leg -> GPIO27, the other leg -> GND (pull-up is inside the ESP32).
// Every press prints once; the blue LED lights while held.
const int BTN = 27, LED = 2;
void setup() { Serial.begin(115200); pinMode(BTN, INPUT_PULLUP); pinMode(LED, OUTPUT); }
void loop() {
  static bool prev = HIGH; static uint32_t lastChange = 0; static int presses = 0;
  bool now = digitalRead(BTN);
  digitalWrite(LED, now == LOW);
  if (now != prev && millis() - lastChange > 40) {       // 40 ms debounce
    lastChange = millis(); prev = now;
    if (now == LOW) Serial.printf("SOS pressed (%d)\n", ++presses);
  }
}
