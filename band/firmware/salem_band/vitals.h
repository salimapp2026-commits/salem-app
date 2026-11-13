// Heart rate and SpO2 from 8 seconds of MAX30102 readings. Written from scratch.
//
// Heart rate: remove the slow "DC" level, smooth the signal, find each heartbeat dip,
//             and turn the average gap between beats into beats per minute.
// SpO2:       compare how much the red and IR signals pulse (AC) against their steady
//             level (DC). That ratio R maps to oxygen saturation. The formula is a general
//             one from Maxim's application note, NOT calibrated for this board: treat the
//             number as indicative, never as a medical reading.
#pragma once
#include <Arduino.h>
#include <math.h>

const int   VITALS_N  = 200;     // 8 s at 25 readings per second
const float VITALS_FS = 25.0f;   // readings per second

struct VitalsResult {
  int  hr = 0;          // beats per minute
  int  spo2 = 0;        // percent
  bool hrValid = false;
  bool spo2Valid = false;
  int  beats = 0;       // how many beats were found (useful when debugging)
};

// Subtracts a 1-second moving average, which removes the slow DC level and drift.
static void vitalsHighPass(const uint32_t* in, float* out, int n) {
  const int W = 25;
  for (int i = 0; i < n; i++) {
    int a = max(0, i - W / 2), b = min(n - 1, i + W / 2);
    float sum = 0;
    for (int k = a; k <= b; k++) sum += in[k];
    out[i] = in[i] - sum / (b - a + 1);
  }
}

inline VitalsResult computeVitals(const uint32_t* red, const uint32_t* ir, int n) {
  VitalsResult r;
  static float acIr[VITALS_N], acRed[VITALS_N], s[VITALS_N];
  if (n > VITALS_N) n = VITALS_N;

  float dcIr = 0, dcRed = 0;
  for (int i = 0; i < n; i++) { dcIr += ir[i]; dcRed += red[i]; }
  dcIr /= n; dcRed /= n;
  if (dcIr < 50000) return r;                       // no finger / band not on skin

  vitalsHighPass(ir, acIr, n);
  vitalsHighPass(red, acRed, n);

  // Smooth with a 4-point average and flip it, so each heartbeat dip becomes a peak.
  for (int i = 0; i < n; i++) {
    float sum = 0; int c = 0;
    for (int k = i - 3; k <= i; k++) if (k >= 0) { sum += acIr[k]; c++; }
    s[i] = -sum / c;
  }

  // Peak finding: above 40 % of the tallest peak, and at least 0.3 s apart (max 200 bpm).
  float top = 0;
  for (int i = 12; i < n - 12; i++) top = max(top, s[i]);
  if (top <= 0) return r;
  const float threshold = 0.4f * top;
  const int minGap = (int)(VITALS_FS * 60.0f / 200.0f);
  int peaks[40]; int np = 0; int last = -minGap;
  for (int i = 12; i < n - 12 && np < 40; i++) {
    if (s[i] > threshold && s[i] >= s[i - 1] && s[i] > s[i + 1] && i - last >= minGap) {
      peaks[np++] = i; last = i;
    }
  }
  r.beats = np;

  if (np >= 3) {
    float mean = (float)(peaks[np - 1] - peaks[0]) / (np - 1);
    float var = 0;
    for (int i = 1; i < np; i++) { float d = (peaks[i] - peaks[i - 1]) - mean; var += d * d; }
    float sd = sqrtf(var / (np - 1));
    r.hr = (int)lroundf(60.0f * VITALS_FS / mean);
    r.hrValid = (sd / mean < 0.25f) && r.hr >= 40 && r.hr <= 180;   // regular beats only
  }

  // SpO2 from the ratio of ratios
  float rmsIr = 0, rmsRed = 0;
  for (int i = 12; i < n - 12; i++) { rmsIr += acIr[i] * acIr[i]; rmsRed += acRed[i] * acRed[i]; }
  rmsIr = sqrtf(rmsIr / (n - 24)); rmsRed = sqrtf(rmsRed / (n - 24));
  if (rmsIr > 0 && dcRed > 0) {
    float R = (rmsRed / dcRed) / (rmsIr / dcIr);
    float spo2 = -45.060f * R * R + 30.354f * R + 94.845f;
    r.spo2 = (int)lroundf(constrain(spo2, 70.0f, 100.0f));
    r.spo2Valid = R > 0.35f && R < 1.1f && r.hrValid;    // only trust it with a clean pulse
  }
  return r;
}
