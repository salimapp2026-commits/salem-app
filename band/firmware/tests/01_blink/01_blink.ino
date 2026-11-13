// Test 1: is the board alive and is the upload working?
// The blue LED on the board blinks once a second and the Serial Monitor (115200) counts.
const int LED = 2;
void setup() { Serial.begin(115200); pinMode(LED, OUTPUT); }
void loop() {
  static int n = 0;
  digitalWrite(LED, HIGH); delay(500);
  digitalWrite(LED, LOW);  delay(500);
  Serial.printf("alive %d\n", ++n);
}
