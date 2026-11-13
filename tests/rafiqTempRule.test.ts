// Founder rule: skin temperature alone never becomes an alert (it is never
// pushed alone). It becomes an alert only when the resting heart rate is up on
// the SAME day — and then the temperature text says so ("together with a higher
// resting heart rate"), even on the first day, before the heart-rate reason has
// the two nights it needs to stand on its own. Found in the salem-prod replay,
// 2026-10-21: level alert, reasons ['temp_up'] only — correct, and pinned here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Agg, type DayFeatures, type Metric, METRICS, decideElder } from '../supabase/functions/_shared/rafiq/core.ts';
import type { RafiqModel } from '../supabase/functions/_shared/rafiq/model.ts';
import { reasonText } from '../supabase/functions/_shared/rafiq/text.ts';

const model = JSON.parse(readFileSync(join(__dirname, '..', 'supabase/functions/_shared/rafiq/model.json'), 'utf8')) as RafiqModel;

/** A day where only night heart rate and night skin temperature are known. */
function day(hr: number, temp: number): DayFeatures {
  const agg = { still_awake_h: 0, falls: 0, fall_still_min: 0 } as Agg;
  const base = {} as DayFeatures['base'];
  const z = {} as Record<Metric, number>;
  for (const m of METRICS) {
    agg[m] = Number.NaN;
    base[m] = null;
    z[m] = Number.NaN;
  }
  agg.hr_night = hr;
  base.hr_night = [71, 2];
  z.hr_night = (hr - 71) / 2;
  agg.temp_night = temp;
  base.temp_night = [33.5, 0.25];
  z.temp_night = (temp - 33.5) / 0.25;
  return { features: {}, vector: [], z, learning: false, base, agg };
}

function decide(days: DayFeatures[]) {
  const feats = new Map(days.map((f, i) => [100 + i, f]));
  return [...decideElder(feats, null, null, model.decide, model.features).values()];
}

describe('temperature is never an alert on its own', () => {
  it('warm skin + higher resting heart rate on the same day: alert on day 1, told as one story', () => {
    const [d1, d2] = decide([day(84, 34.4), day(84, 34.5)]);
    expect(d1.level).toBe('alert');
    expect(d1.reasons.map((r) => [r.code, r.level])).toEqual([['temp_up', 'alert']]);
    expect(reasonText(d1.reasons[0], 'Mona', 'en')).toContain('together with a higher resting heart rate');
    // Night 2: the heart-rate reason now stands on its own too (run.ts pushes it inside the temperature text).
    expect(d2.reasons.map((r) => r.code).sort()).toEqual(['resting_hr_up', 'temp_up']);
  });

  it('warm skin, usual heart rate: never more than watch (in-app only), however long it lasts', () => {
    const ds = decide([day(71, 34.4), day(71, 34.5), day(72, 34.5), day(71, 34.6), day(72, 34.4)]);
    expect(ds[0].reasons).toEqual([]);          // one warm day is nothing
    for (const d of ds.slice(1)) {
      expect(d.reasons.map((r) => [r.code, r.level])).toEqual([['temp_up', 'watch']]);
      expect(reasonText(d.reasons[0], 'Mona', 'en')).not.toContain('heart rate');
    }
  });

  it('heart rate up by less than the minimum (+5 bpm) does not lift temperature to alert', () => {
    const ds = decide([day(75, 34.4), day(75, 34.5), day(75, 34.5)]);
    expect(ds.every((d) => d.level !== 'alert')).toBe(true);
  });
});
