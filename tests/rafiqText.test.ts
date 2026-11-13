// Rafiq's texts: every reason in both languages, the closing note always there,
// and never a diagnosis or a condition name.
import { describe, expect, it } from 'vitest';
import type { Level, Reason } from '../supabase/functions/_shared/rafiq/core.ts';
import { alertText, NOTE, NOT_A_DEVICE, pushTitle, reasonText } from '../supabase/functions/_shared/rafiq/text.ts';

const R = (code: string, level: Level, days: number, params: Reason['params']): Reason => ({ code, level, days, params });
const REASONS: Reason[] = [
  R('resting_hr_up', 'alert', 4, { delta: 12.4, usual: 61.5, value: 73.9, z: 4.1, part: 'hr_night' }),
  R('resting_hr_up', 'watch', 2, { delta: 6, usual: 70, value: 76, z: 2.3, part: 'hr_day' }),
  R('spo2_night_down', 'alert', 3, { drop: 3, low_drop: 4, usual: 96, value: 93 }),
  R('spo2_night_down', 'watch', 2, { drop: Number.NaN, low_drop: 4, usual: Number.NaN, value: Number.NaN }),
  R('temp_up', 'alert', 1, { delta: 1.24, usual: 33.1, value: 34.34 }),
  R('temp_up', 'watch', 2, { delta: 0.45, usual: 33.1, value: 33.55 }),
  R('activity_down', 'alert', 3, { ratio: 0.31, usual: 420, value: 130 }),
  R('spo2_low_hr_high', 'urgent', 1, { spo2: 89, hr_rise: 17 }),
  R('inactive_awake', 'urgent', 1, { hours: 6.5 }),
  R('fall_then_still', 'alert', 1, { minutes: 40 }),
  R('unusual_pattern', 'watch', 1, { top: ['z_hr_night', 'z_temp_night'] }),
];
const FORBIDDEN = /fever|infection|apnea|apnoea|covid|pneumonia|heart attack|stroke|diagnos(is|ed) (of|with)|you have|حمى|حمّى|عدوى|التهاب|انقطاع النفس|جلطة/i;

describe('Rafiq texts', () => {
  for (const r of REASONS) {
    for (const lang of ['en', 'ar'] as const) {
      it(`${r.code} (${r.level}) in ${lang}`, () => {
        const text = alertText(r, 'Mona', lang);
        expect(text).toContain('Mona');
        expect(text.endsWith(NOTE[lang]('Mona'))).toBe(true);
        expect(text).not.toMatch(/NaN|undefined|null|\{|\}/);
        expect(reasonText(r, 'Mona', lang)).not.toMatch(FORBIDDEN);
        if (lang === 'ar') expect(text).toMatch(/[؀-ۿ]/);
      });
    }
  }

  it('the closing note says "not a diagnosis" and "contact the doctor"', () => {
    expect(NOTE.en('Mona')).toMatch(/unusual compared to Mona's normal.*not a diagnosis.*Contact the doctor/);
    expect(NOTE.ar('Mona')).toMatch(/وليس تشخيصًا.*تواصل مع الطبيب/);
    expect(NOT_A_DEVICE.en).toMatch(/not a medical device/);
    expect(NOT_A_DEVICE.ar).toMatch(/ليس جهازًا طبيًا/);
  });

  it('numbers read naturally', () => {
    expect(reasonText(REASONS[0], 'Mona', 'en')).toBe(
      "Mona's resting heart rate has been 12 bpm above their usual (62 bpm) for 4 nights.");
    expect(reasonText(REASONS[6], 'Mona', 'en')).toBe('Mona has been about 69% less active than usual for 3 days.');
    expect(reasonText(REASONS[2], 'Mona', 'ar')).toContain('منذ 3 ليالٍ');
    expect(reasonText(REASONS[1], 'Mona', 'ar')).toContain('منذ يومين');
  });

  it('temperature alone is described without a heart-rate claim', () => {
    expect(reasonText(REASONS[5], 'Mona', 'en')).not.toMatch(/heart/);
    expect(reasonText(REASONS[4], 'Mona', 'en')).toMatch(/together with a higher resting heart rate/);
  });

  it('push titles per level, both languages', () => {
    for (const level of ['watch', 'alert', 'urgent'] as const) {
      expect(pushTitle(level, 'Mona', 'en')).toMatch(/^Rafiq: .*Mona/);
      expect(pushTitle(level, 'Mona', 'ar')).toMatch(/^رفيق: .*Mona/);
    }
  });
});
