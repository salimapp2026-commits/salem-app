import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  type DayValue,
  addDays,
  clampSeverity,
  combineSeverities,
  computeBaseline,
  cooldownClear,
  decide,
  detect,
  isPaused,
  mad,
  median,
  shouldResolve,
} from '../supabase/functions/_shared/trendRules.ts';
import type { Metric } from '../supabase/functions/_shared/trendText.ts';

const C = DEFAULT_CONFIG;
const D = '2026-10-12'; // the day being evaluated

/** Build `count` days ending at `end`, value from fn(i) where i=0 is the oldest. */
function series(count: number, fn: (i: number, day: string) => number, end = D, enough = true): DayValue[] {
  const out: DayValue[] = [];
  for (let i = 0; i < count; i++) {
    const day = addDays(end, -(count - 1 - i));
    out.push({ day, value: fn(i, day), enough });
  }
  return out;
}

/** Deterministic small wobble so data isn't perfectly flat. */
const wobble = (i: number, amp: number) => ((i * 37) % 7) / 6 * 2 * amp - amp;

function run(metric: Metric, s: DayValue[], extra?: { hr?: DayValue[] }) {
  const base = computeBaseline(metric, s, D, C);
  const hrBase = extra?.hr ? computeBaseline('resting_hr', extra.hr, D, C) : undefined;
  return { base, det: detect(metric, s, base, D, C, hrBase, extra?.hr) };
}

describe('baseline maths', () => {
  it('median and MAD', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(mad([1, 2, 3, 4, 100])).toBe(1); // robust: the outlier barely moves it
  });

  it('uses only days D-34..D-7 — recent days and older days are ignored', () => {
    const s = series(60, (_i, day) => {
      if (day > addDays(D, -7)) return 200; // recent week: must not count
      if (day < addDays(D, -34)) return 999; // older than the window: must not count
      return 70;
    });
    const b = computeBaseline('resting_hr', s, D, C);
    expect(b.baselineDays).toBe(28);
    expect(b.median).toBe(70);
    expect(b.mad).toBe(0);
    // MAD is 0, so the normal range falls back to the floor (4 bpm).
    expect(b.low).toBe(66);
    expect(b.high).toBe(74);
  });

  it('days without enough readings are left out', () => {
    const s = series(40, (i) => 70 + wobble(i, 2)).map((d, i) => (i % 2 ? { ...d, enough: false, value: 500 } : d));
    const b = computeBaseline('resting_hr', s, D, C);
    expect(b.median).toBeGreaterThan(65);
    expect(b.median).toBeLessThan(75);
  });
});

describe('learning period', () => {
  it('13 days of readings: still learning, day 13 of 14, no alert even with a big change', () => {
    const s = series(13, (i) => (i > 7 ? 100 : 70));
    const { base, det } = run('resting_hr', s);
    expect(base.learning).toBe(true);
    expect(base.learningDay).toBe(13);
    expect(det).toBeNull();
  });

  it('14 days of readings: learning ends', () => {
    const s = series(14, (i) => 70 + wobble(i, 2));
    const { base } = run('resting_hr', s);
    expect(base.learning).toBe(false);
    expect(base.learningDay).toBe(14);
  });
});

describe('resting heart rate (7-day median ≥ +10 for 3 consecutive days)', () => {
  const normal = (i: number) => 68 + wobble(i, 2);

  it('a single-day spike never alerts', () => {
    const s = series(45, (i) => (i === 44 ? 110 : normal(i)));
    expect(run('resting_hr', s).det).toBeNull();
  });

  it('a 5-day rise has not alerted yet on its last day…', () => {
    // The 7-day median only crosses +10 once 4 of 7 days are raised, so on the
    // rise's 5th day there are just 2 qualifying days.
    const s = series(45, (i) => (i >= 40 ? 82 : normal(i)));
    expect(run('resting_hr', s).det).toBeNull();
  });

  it('…but alerts the day AFTER it ends, because the 7-day median lags', () => {
    // Found by the live replay: the median stays raised while 4+ of the last
    // 7 days are raised, so qualifying days run on past the end of the rise.
    // Spec-exact behaviour; flagged for the medical advisor.
    const s = series(45, (i) => (i >= 39 && i <= 43 ? 82 : normal(i)));
    const { det } = run('resting_hr', s);
    expect(det?.severity).toBe('warning');
    expect(s[44].value).toBeLessThan(75); // the evaluated day itself is back to normal
  });

  it('a 6-day rise alerts as a warning, 3 qualifying days', () => {
    const s = series(45, (i) => (i >= 39 ? 82 : normal(i)));
    const { det } = run('resting_hr', s);
    expect(det?.severity).toBe('warning');
    expect(det?.days).toBe(3);
    expect(det!.change).toBeGreaterThanOrEqual(10);
  });

  it('a rise below the threshold does not alert', () => {
    const s = series(45, (i) => (i >= 35 ? 76 : normal(i)));
    expect(run('resting_hr', s).det).toBeNull();
  });
});

describe('blood oxygen (≥3 points below on 3 of the last 5 days)', () => {
  const normal = (i: number) => 97 + wobble(i, 0.5);
  it('2 low days of 5: no alert', () => {
    const s = series(45, (i) => (i === 41 || i === 43 ? 93 : normal(i)));
    expect(run('spo2', s).det).toBeNull();
  });
  it('3 low days of 5 (not consecutive): warning', () => {
    const s = series(45, (i) => (i === 40 || i === 42 || i === 44 ? 93 : normal(i)));
    const { det } = run('spo2', s);
    expect(det?.severity).toBe('warning');
    expect(det?.days).toBe(3);
  });
});

describe('skin temperature', () => {
  const normal = (i: number) => 33.5 + wobble(i, 0.1);
  it('one warm day: no alert', () => {
    const s = series(45, (i) => (i === 44 ? 34.4 : normal(i)));
    expect(run('skin_temp', s).det).toBeNull();
  });
  it('2 warm days: info', () => {
    const s = series(45, (i) => (i >= 43 ? 34.2 : normal(i)));
    expect(run('skin_temp', s).det?.severity).toBe('info');
  });
  it('2 warm days with heart rate up on the same days: warning', () => {
    const s = series(45, (i) => (i >= 43 ? 34.2 : normal(i)));
    const hr = series(45, (i) => (i >= 43 ? 82 : 68 + wobble(i, 2)));
    expect(run('skin_temp', s, { hr }).det?.severity).toBe('warning');
  });
});

describe('activity (7-day average vs baseline)', () => {
  const normal = (i: number) => 5500 + wobble(i, 300);
  it('35% drop: nothing', () => {
    const s = series(45, (i) => (i >= 38 ? 3575 : normal(i)));
    expect(run('activity', s).det).toBeNull();
  });
  it('45% drop: info', () => {
    const s = series(45, (i) => (i >= 38 ? 3000 : normal(i)));
    expect(run('activity', s).det?.severity).toBe('info');
  });
  it('65% drop: warning', () => {
    const s = series(45, (i) => (i >= 38 ? 1900 : normal(i)));
    expect(run('activity', s).det?.severity).toBe('warning');
  });
  it('days the band was barely worn do not count as inactive days', () => {
    const s = series(45, (i) => (i >= 38 ? 300 : normal(i))).map((d, i) =>
      i >= 38 ? { ...d, enough: false } : d,
    );
    expect(run('activity', s).det).toBeNull();
  });
});

describe('night restlessness, blood pressure, glucose', () => {
  it('night movement +60% for 3 nights: info; for 2 nights: nothing', () => {
    const three = series(45, (i) => (i >= 42 ? 160 : 100 + wobble(i, 5)));
    const two = series(45, (i) => (i >= 43 ? 160 : 100 + wobble(i, 5)));
    expect(run('night_restlessness', three).det?.severity).toBe('info');
    expect(run('night_restlessness', two).det).toBeNull();
  });

  it('manual BP: one reading a day is enough; average +16 → warning', () => {
    const s = series(45, (i) => (i >= 38 ? 146 : 130 + wobble(i, 3)));
    const { det } = run('bp_systolic', s);
    expect(det?.severity).toBe('warning');
    expect(det!.change).toBeGreaterThanOrEqual(15);
  });

  it('manual BP: only 2 readings this week → not enough to judge', () => {
    const s = series(45, (i) => (i >= 38 ? 150 : 130)).filter((d, i) => i < 38 || i >= 43);
    expect(run('bp_systolic', s).det).toBeNull();
  });

  it('glucose +25% → info', () => {
    const s = series(45, (i) => (i >= 38 ? 150 : 120 + wobble(i, 4)));
    expect(run('glucose', s).det?.severity).toBe('info');
  });
});

describe('combining and severity caps', () => {
  it('two metrics changing in the same week lift info to warning', () => {
    expect(combineSeverities(['activity', 'resting_hr'], 'info')).toBe('warning');
  });
  it('one metric alone stays as it is', () => {
    expect(combineSeverities(['activity'], 'info')).toBe('info');
  });
  it('warning is the ceiling — never critical', () => {
    expect(combineSeverities(['activity', 'resting_hr', 'spo2'], 'warning')).toBe('warning');
    expect(clampSeverity('critical')).toBe('warning');
    expect(clampSeverity('info')).toBe('info');
    expect(clampSeverity('anything-else')).toBe('info');
  });
});

describe('cooldown, auto-resolve, mark as expected', () => {
  const det = {
    metric: 'activity' as Metric,
    severity: 'info' as const,
    baseline: 5500,
    current: 3000,
    change: 45,
    changeUnit: 'pct' as const,
    days: 7,
  };
  const now = '2026-10-12T04:00:00Z';

  it('72-hour cooldown before re-alerting the same metric', () => {
    const prior48 = { metric: 'activity' as Metric, status: 'resolved' as const, lastNotifiedAt: '2026-10-10T04:00:00Z' };
    const prior73 = { metric: 'activity' as Metric, status: 'resolved' as const, lastNotifiedAt: '2026-10-09T03:00:00Z' };
    expect(cooldownClear(prior48, now, C)).toBe(false);
    expect(cooldownClear(prior73, now, C)).toBe(true);
    expect(decide({ detection: det, open: undefined, prior: prior48, resolveNow: false, paused: false, nowIso: now, c: C }))
      .toEqual({ kind: 'open', detection: det, notify: false });
  });

  it('a finding opened silently inside the cooldown notifies once it ends', () => {
    const open = { id: 'f1', metric: 'activity' as Metric, severity: 'info' as const, lastNotifiedAt: null };
    const prior73 = { metric: 'activity' as Metric, status: 'resolved' as const, lastNotifiedAt: '2026-10-09T03:00:00Z' };
    const a = decide({ detection: det, open, prior: prior73, resolveNow: false, paused: false, nowIso: now, c: C });
    expect(a).toMatchObject({ kind: 'update', notify: true, escalated: false });
  });

  it('only one open finding per metric: a still-open finding is updated, not duplicated', () => {
    const open = { id: 'f1', metric: 'activity' as Metric, severity: 'info' as const, lastNotifiedAt: '2026-10-11T04:00:00Z' };
    const a = decide({ detection: det, open, prior: undefined, resolveNow: false, paused: false, nowIso: now, c: C });
    expect(a).toMatchObject({ kind: 'update', findingId: 'f1', notify: false });
  });

  it('escalating info → warning notifies even inside the cooldown', () => {
    const open = { id: 'f1', metric: 'activity' as Metric, severity: 'info' as const, lastNotifiedAt: '2026-10-11T04:00:00Z' };
    const a = decide({ detection: { ...det, severity: 'warning' }, open, prior: undefined, resolveNow: false, paused: false, nowIso: now, c: C });
    expect(a).toMatchObject({ kind: 'update', escalated: true, notify: true });
  });

  it('auto-resolves after 3 days inside the normal range — not after 2', () => {
    const settled3 = series(45, (i) => (i >= 35 && i < 42 ? 3000 : 5500));
    const settled2 = series(45, (i) => (i >= 35 && i < 43 ? 3000 : 5500));
    const b3 = computeBaseline('activity', settled3, D, C);
    const b2 = computeBaseline('activity', settled2, D, C);
    expect(shouldResolve(settled3, b3, D, C)).toBe(true);
    expect(shouldResolve(settled2, b2, D, C)).toBe(false);
    const open = { id: 'f1', metric: 'activity' as Metric, severity: 'info' as const, lastNotifiedAt: null };
    expect(decide({ detection: null, open, prior: undefined, resolveNow: true, paused: false, nowIso: now, c: C }))
      .toEqual({ kind: 'resolve', findingId: 'f1' });
  });

  it('"mark as expected" pauses the metric for 14 days', () => {
    const pausedUntil = addDays('2026-10-05', 14);
    expect(isPaused(pausedUntil, D)).toBe(true);
    expect(isPaused(pausedUntil, addDays(pausedUntil, 1))).toBe(false);
    expect(decide({ detection: det, open: undefined, prior: undefined, resolveNow: false, paused: true, nowIso: now, c: C }))
      .toEqual({ kind: 'none' });
  });

  it('"mark as expected" restarts the baseline from that date (back to learning)', () => {
    const s = series(45, (i) => 70 + wobble(i, 2));
    const resetAt = addDays(D, -5);
    const b = computeBaseline('resting_hr', s, D, C, resetAt);
    expect(b.learning).toBe(true);
    expect(b.learningDay).toBe(6); // only the days since the reset count
  });
});
