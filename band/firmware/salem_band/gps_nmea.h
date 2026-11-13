// GPS reader for the NEO-6M / NEO-8M, written from scratch. No library needed.
//
// The GPS module sends lines of text called NMEA sentences, about once a second, e.g.
//   $GPRMC,123519,A,3003.1234,N,03114.5678,E,0.0,0.0,161026,,,A*6C
//   $GPGGA,123519,3003.1234,N,03114.5678,E,1,08,0.9,25.0,M,15.0,M,,*47
// RMC gives the position ("A" = valid fix, "V" = no fix yet).
// GGA gives the number of satellites in use.
// Newer modules start lines with $GN instead of $GP; both are handled.
#pragma once
#include <Arduino.h>
#include <string.h>
#include <stdlib.h>

struct GpsFix {
  bool     valid = false;      // true once we have had at least one good position
  double   lat = 0, lon = 0;   // degrees, south and west are negative
  int      sats = 0;
  uint32_t fixMillis = 0;      // when the last good position arrived
  uint32_t chars = 0;          // bytes received (0 = check the wiring)
  uint32_t sentences = 0;      // lines that passed the checksum
  uint32_t ageMs() const { return valid ? millis() - fixMillis : 0xFFFFFFFF; }
};

class NmeaParser {
 public:
  GpsFix fix;

  // Give it every byte that arrives from the GPS.
  void feed(char c) {
    fix.chars++;
    if (c == '$') len = 0;                  // a new sentence starts
    if (c == '\r') return;
    if (c == '\n') { buf[len] = 0; handle(buf); len = 0; return; }
    if (len < (int)sizeof(buf) - 1) buf[len++] = c;
  }

 private:
  char buf[100];
  int len = 0;

  static int hexValue(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  }

  // The two hex digits after '*' are the XOR of every character between '$' and '*'.
  static bool checksumOk(const char* s) {
    const char* star = strchr(s, '*');
    if (!star || hexValue(star[1]) < 0 || hexValue(star[2]) < 0) return false;
    uint8_t cs = 0;
    for (const char* p = s + 1; p < star; p++) cs ^= (uint8_t)*p;
    return ((hexValue(star[1]) << 4) | hexValue(star[2])) == cs;
  }

  // NMEA writes 30 degrees 03.1234 minutes as "3003.1234"; convert to decimal degrees.
  static double toDegrees(const char* v, char hemisphere) {
    if (!*v) return 0;
    double x = atof(v);
    int deg = (int)(x / 100);
    double d = deg + (x - deg * 100) / 60.0;
    return (hemisphere == 'S' || hemisphere == 'W') ? -d : d;
  }

  void handle(char* s) {
    if (s[0] != '$' || !checksumOk(s)) return;
    fix.sentences++;
    char* f[20]; int n = 0;                 // split on commas (and the '*')
    f[n++] = s;
    for (char* p = s; *p && n < 20; p++)
      if (*p == ',' || *p == '*') { *p = 0; f[n++] = p + 1; }
    if (strlen(f[0]) < 6) return;
    const char* type = f[0] + 3;            // "$GPRMC" -> "RMC"
    if (!strcmp(type, "RMC") && n > 6 && f[2][0] == 'A') {
      fix.lat = toDegrees(f[3], f[4][0]);
      fix.lon = toDegrees(f[5], f[6][0]);
      fix.valid = true;
      fix.fixMillis = millis();
    } else if (!strcmp(type, "GGA") && n > 7) {
      fix.sats = atoi(f[7]);
    }
  }
};
