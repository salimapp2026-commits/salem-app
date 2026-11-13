// Health Connect records become rows Rafiq can read: resting heart rate and
// oxygen with a quality, steps per 10-minute block, worn blocks marked.
import { describe, expect, it } from 'vitest';
import { BLOCK_SECONDS, HC_QUALITY, chunks, hcRows, syncWindow } from '../native/src/lib/hcRows';
import { dayAggregates, KIND, type Rows } from '../supabase/functions/_shared/rafiq/core';
import { model } from '../supabase/functions/_shared/rafiq/modelParts';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const at = (hhmm: string, day = '2026-11-03') => `${day}T${hhmm}:00.000Z`;
const none = { heartRate: [], steps: [], oxygen: [], sleep: [] };

describe('Health Connect → Rafiq rows', () => {
  it('steps are split into 10-minute blocks by overlap', () => {
    const rows = hcRows({ ...none, steps: [{ startTime: at('09:05'), endTime: at('09:25'), count: 400 }] }, NOW);
    expect(rows).toEqual([
      { k: 'steps', t: at('09:00'), v: 100, r: false, q: null },
      { k: 'steps', t: at('09:10'), v: 200, r: false, q: null },
      { k: 'steps', t: at('09:20'), v: 100, r: false, q: null },
    ]);
  });

  it('a block with heart rate but no steps is sent as 0 steps (worn, still); heart rate there is resting', () => {
    const rows = hcRows({ ...none, heartRate: [{ startTime: at('10:00'), endTime: at('10:10'),
      samples: [{ time: at('10:02'), beatsPerMinute: 64 }] }] }, NOW);
    expect(rows).toEqual([
      { k: 'heart_rate', t: at('10:02'), v: 64, r: true, q: HC_QUALITY },
      { k: 'steps', t: at('10:00'), v: 0, r: false, q: null },
    ]);
  });

  it('heart rate while walking is not resting; during sleep it is, even with a step', () => {
    const rows = hcRows({
      heartRate: [{ startTime: at('09:00'), endTime: at('23:59', '2026-11-02'), samples: [
        { time: at('09:12'), beatsPerMinute: 101 },
        { time: at('03:15'), beatsPerMinute: 55 },
      ] }],
      steps: [{ startTime: at('09:10'), endTime: at('09:20'), count: 600 }, { startTime: at('03:10'), endTime: at('03:20'), count: 3 }],
      oxygen: [{ time: at('03:16'), percentage: { value: 95.04 } }],
      sleep: [{ startTime: at('23:00', '2026-11-02'), endTime: at('06:30') }],
    }, NOW);
    const hr = rows.filter((r) => r.k === 'heart_rate').map((r) => [r.v, r.r]);
    expect(hr).toEqual([[55, true], [101, false]]);
    expect(rows.find((r) => r.k === 'spo2')).toEqual({ k: 'spo2', t: at('03:16'), v: 95, r: true, q: HC_QUALITY });
  });

  it('one sample per minute; nothing from a block still running', () => {
    const rows = hcRows({ ...none, heartRate: [{ startTime: at('11:40'), endTime: at('12:00'), samples: [
      { time: '2026-11-03T11:41:05Z', beatsPerMinute: 70 },
      { time: '2026-11-03T11:41:40Z', beatsPerMinute: 90 },
      { time: '2026-11-03T11:59:00Z', beatsPerMinute: 70 },
    ] }] }, Date.parse('2026-11-03T11:55:00Z'));
    expect(rows).toEqual([
      { k: 'heart_rate', t: '2026-11-03T11:41:00.000Z', v: 70, r: true, q: HC_QUALITY },
      { k: 'steps', t: at('11:40'), v: 0, r: false, q: null },
    ]);
  });

  it('Rafiq reads a day of these rows: resting heart rate, oxygen, steps and hours worn all come out', () => {
    const P = model.params;
    const hr: { time: string; beatsPerMinute: number }[] = [];
    const ox: { time: string; percentage: number }[] = [];
    const steps: { startTime: string; endTime: string; count: number }[] = [];
    // 2026-11-02 07:00 → 2026-11-03 07:00 Cairo (UTC+2): a sample every 5 minutes, walking 09–12 local.
    for (let t = Date.parse('2026-11-02T05:00:00Z'); t < Date.parse('2026-11-03T05:00:00Z'); t += 300_000) {
      const local = new Date(t + 7_200_000).getUTCHours();
      hr.push({ time: new Date(t).toISOString(), beatsPerMinute: local >= 22 || local < 7 ? 58 : 72 });
      if (local >= 22 || local < 7) ox.push({ time: new Date(t).toISOString(), percentage: 96 });
      if (local >= 9 && local < 12) steps.push({ startTime: new Date(t).toISOString(), endTime: new Date(t + 300_000).toISOString(), count: 50 });
    }
    const out = hcRows({ heartRate: [{ startTime: hr[0].time, endTime: hr.at(-1)!.time, samples: hr }], steps, oxygen: ox,
      sleep: [{ startTime: '2026-11-02T20:00:00Z', endTime: '2026-11-03T05:00:00Z' }] }, NOW);
    const rows: Rows = { t: [], kind: [], value: [], resting: [], quality: [] };
    for (const r of [...out].sort((a, b) => Date.parse(a.t) - Date.parse(b.t))) {
      rows.t.push(Date.parse(r.t) / 1000);
      rows.kind.push(KIND[r.k]);
      rows.value.push(r.v);
      rows.resting.push(r.r);
      rows.quality.push(r.q ?? 255);
    }
    const agg = [...dayAggregates(rows, { t: [], kind: [] }, 'Africa/Cairo', P).values()][0];
    expect(agg.wear).toBe(24);                    // worn all day → counts toward learning
    expect(agg.hr_night).toBe(58);
    expect(agg.hr_day).toBe(72);                  // resting daytime samples only
    expect(agg.spo2_night).toBe(96);
    expect(agg.steps).toBeCloseTo((36 * 50) / 15, 5);   // per hour worn in the day segment
    expect(agg.falls).toBe(0);                    // never a fall from Health Connect
  });

  it('sync window: 30 days the first time, then the last 48 h again', () => {
    const DAY = 86_400_000;
    expect(syncWindow(null, NOW)).toEqual({ fromMs: NOW - 30 * DAY, toMs: NOW });
    expect(syncWindow(NOW - DAY, NOW)).toEqual({ fromMs: NOW - 3 * DAY, toMs: NOW });
    expect(syncWindow(NOW - 60 * DAY, NOW)).toEqual({ fromMs: NOW - 30 * DAY, toMs: NOW });
  });

  it('calls stay under hc_ingest\'s 5000-row limit', () => {
    expect(chunks(Array.from({ length: 4500 }, (_, i) => i)).map((c) => c.length)).toEqual([2000, 2000, 500]);
    expect(BLOCK_SECONDS).toBe(600);   // the same 10-minute block as core.ts
  });
});
