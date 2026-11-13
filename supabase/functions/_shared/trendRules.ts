// Trend Watch rules engine. Pure functions only — no database, no network —
// so the edge function and the test suite run the same code.
//
// Input: one value per day per metric (from vital_daily_summaries) plus the
// thresholds from trend_config. Output: each metric's baseline, whether it is
// still learning, and whether today's data triggers a finding.
//
// Definitions (from the product spec):
//   • Baseline: the 28 days BEFORE the most recent 7 (days D-34 … D-7, where D
//     is the day being evaluated). Median plus a robust spread (MAD).
//   • Learning: until a metric has 14 days with enough readings, it raises
//     nothing.
//   • A single day never alerts; every rule needs several days.
//   • Trend Watch never produces 'critical'. Enforced here AND by a database
//     check constraint.

import type { Metric } from './trendText.ts';

export type Severity = 'info' | 'warning';

export type DayValue = {
  day: string; // YYYY-MM-DD in the elder's timezone
  value: number; // the metric's daily value (median / mean / total — see dailyValueOf)
  enough: boolean; // met the minimum-readings rule for that day
};

export type Config = Record<string, number>;

/** Defaults mirror the trend_config seed rows. The table always wins at runtime. */
export const DEFAULT_CONFIG: Config = {
  baseline_window_days: 28,
  recent_window_days: 7,
  learning_min_days: 14,
  baseline_min_days: 7,
  normal_band_mads: 2,
  hr_delta_bpm: 10,
  hr_window_days: 7,
  hr_window_min_days: 4,
  hr_consecutive_days: 3,
  spo2_drop_points: 3,
  spo2_days_required: 3,
  spo2_days_window: 5,
  skin_temp_delta_c: 0.5,
  skin_temp_consecutive_days: 2,
  activity_info_drop_pct: 40,
  activity_warning_drop_pct: 60,
  activity_min_days: 4,
  night_rise_pct: 50,
  night_consecutive_days: 3,
  bp_systolic_delta: 15,
  bp_min_days: 3,
  glucose_rise_pct: 20,
  glucose_min_days: 3,
  cooldown_hours: 72,
  resolve_days: 3,
  expected_pause_days: 14,
  normal_floor_resting_hr: 4,
  normal_floor_spo2: 1,
  normal_floor_skin_temp: 0.2,
  normal_floor_activity_pct: 15,
  normal_floor_night_restlessness_pct: 20,
  normal_floor_bp_systolic: 6,
  normal_floor_glucose_pct: 8,
};

export function cfg(c: Config, key: string): number {
  const v = c[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_CONFIG[key];
}

// ------------------------------------------------------------------ dates
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

// ------------------------------------------------------------------- stats
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Median absolute deviation (unscaled). */
export function mad(xs: number[]): number | null {
  const m = median(xs);
  if (m == null) return null;
  return median(xs.map((x) => Math.abs(x - m)));
}

// --------------------------------------------------------------- baseline
export type Baseline = {
  metric: Metric;
  learning: boolean;
  learningDay: number; // 0..learning_min_days
  validDays: number; // enough-days in the 35-day view
  baselineDays: number; // enough-days inside the baseline window
  median: number | null;
  mean: number | null;
  mad: number | null;
  low: number | null; // normal range shown on charts, used for auto-resolve
  high: number | null;
  resetAt: string | null;
};

/** Metrics whose normal-range floor is a percentage of the median. */
const PCT_FLOOR: Partial<Record<Metric, true>> = {
  activity: true,
  night_restlessness: true,
  glucose: true,
};

export function computeBaseline(
  metric: Metric,
  series: DayValue[],
  asOf: string,
  c: Config,
  resetAt: string | null = null,
): Baseline {
  const recent = cfg(c, 'recent_window_days');
  const window = cfg(c, 'baseline_window_days');
  const start = addDays(asOf, -(recent + window - 1)); // D-34
  const end = addDays(asOf, -recent); // D-7

  const usable = series.filter(
    (d) => d.enough && (!resetAt || d.day >= resetAt) && d.day <= asOf && d.day >= start,
  );
  const inWindow = usable.filter((d) => d.day <= end).map((d) => d.value);

  const learningMin = cfg(c, 'learning_min_days');
  const validDays = usable.length;
  const learning = validDays < learningMin || inWindow.length < cfg(c, 'baseline_min_days');

  const med = median(inWindow);
  const avg = mean(inWindow);
  const m = mad(inWindow);
  let low: number | null = null;
  let high: number | null = null;
  if (med != null && m != null) {
    // 1.4826 × MAD estimates a standard deviation for normally-spread data.
    const spread = cfg(c, 'normal_band_mads') * 1.4826 * m;
    const floorKey = PCT_FLOOR[metric] ? `normal_floor_${metric}_pct` : `normal_floor_${metric}`;
    const floor = PCT_FLOOR[metric] ? (Math.abs(med) * cfg(c, floorKey)) / 100 : cfg(c, floorKey);
    const half = Math.max(spread, floor);
    low = med - half;
    high = med + half;
  }

  return {
    metric,
    learning,
    learningDay: Math.min(validDays, learningMin),
    validDays,
    baselineDays: inWindow.length,
    median: med,
    mean: avg,
    mad: m,
    low,
    high,
    resetAt,
  };
}

// ---------------------------------------------------------------- detection
export type Detection = {
  metric: Metric;
  severity: Severity;
  baseline: number;
  current: number;
  change: number; // signed; percent for pct metrics
  changeUnit: 'bpm' | 'points' | 'C' | 'pct' | 'mmHg';
  days: number;
};

function byDay(series: DayValue[]): Map<string, DayValue> {
  return new Map(series.filter((d) => d.enough).map((d) => [d.day, d]));
}

function valuesIn(map: Map<string, DayValue>, from: string, to: string): number[] {
  const out: number[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = map.get(d);
    if (v) out.push(v.value);
  }
  return out;
}

/** Count consecutive days ending at `asOf` (going back) for which `test` is true. */
function streak(asOf: string, test: (day: string) => boolean, max = 60): number {
  let n = 0;
  for (let d = asOf; n < max && test(d); d = addDays(d, -1)) n++;
  return n;
}

export function detect(
  metric: Metric,
  series: DayValue[],
  base: Baseline,
  asOf: string,
  c: Config,
  hrBase?: Baseline,
  hrSeries?: DayValue[],
): Detection | null {
  if (base.learning || base.median == null || base.mean == null) return null;
  const map = byDay(series);
  const B = base.median;

  switch (metric) {
    case 'resting_hr': {
      const win = cfg(c, 'hr_window_days');
      const minDays = cfg(c, 'hr_window_min_days');
      const delta = cfg(c, 'hr_delta_bpm');
      const rolling = (day: string): number | null => {
        const vals = valuesIn(map, addDays(day, -(win - 1)), day);
        return vals.length >= minDays ? median(vals) : null;
      };
      const qualifies = (day: string) => {
        const r = rolling(day);
        return r != null && r - B >= delta;
      };
      const days = streak(asOf, qualifies);
      if (days < cfg(c, 'hr_consecutive_days')) return null;
      const cur = rolling(asOf)!;
      return { metric, severity: 'warning', baseline: B, current: cur, change: cur - B, changeUnit: 'bpm', days };
    }

    case 'spo2': {
      const windowDays = cfg(c, 'spo2_days_window');
      const vals = valuesIn(map, addDays(asOf, -(windowDays - 1)), asOf);
      const low = vals.filter((v) => B - v >= cfg(c, 'spo2_drop_points'));
      if (low.length < cfg(c, 'spo2_days_required')) return null;
      const cur = median(low)!;
      return { metric, severity: 'warning', baseline: B, current: cur, change: cur - B, changeUnit: 'points', days: low.length };
    }

    case 'skin_temp': {
      const delta = cfg(c, 'skin_temp_delta_c');
      const above = (day: string) => {
        const v = map.get(day);
        return !!v && v.value - B >= delta;
      };
      const days = streak(asOf, above);
      if (days < cfg(c, 'skin_temp_consecutive_days')) return null;
      const vals = valuesIn(map, addDays(asOf, -(days - 1)), asOf);
      const cur = mean(vals)!;
      // Heart rate up on the SAME days lifts this to a warning.
      let severity: Severity = 'info';
      if (hrBase && hrSeries && !hrBase.learning && hrBase.median != null) {
        const hrMap = byDay(hrSeries);
        const hrDelta = cfg(c, 'hr_delta_bpm');
        let together = true;
        for (let d = addDays(asOf, -(days - 1)); d <= asOf; d = addDays(d, 1)) {
          const h = hrMap.get(d);
          if (!h || h.value - hrBase.median < hrDelta) together = false;
        }
        if (together) severity = 'warning';
      }
      return { metric, severity, baseline: B, current: cur, change: cur - B, changeUnit: 'C', days };
    }

    case 'activity': {
      const recent = cfg(c, 'recent_window_days');
      const vals = valuesIn(map, addDays(asOf, -(recent - 1)), asOf);
      if (vals.length < cfg(c, 'activity_min_days') || B <= 0) return null;
      const avg = mean(vals)!;
      const dropPct = ((B - avg) / B) * 100;
      let severity: Severity | null = null;
      if (dropPct >= cfg(c, 'activity_warning_drop_pct')) severity = 'warning';
      else if (dropPct >= cfg(c, 'activity_info_drop_pct')) severity = 'info';
      if (!severity) return null;
      return { metric, severity, baseline: B, current: avg, change: dropPct, changeUnit: 'pct', days: vals.length };
    }

    case 'night_restlessness': {
      if (B <= 0) return null;
      const rise = cfg(c, 'night_rise_pct');
      const above = (day: string) => {
        const v = map.get(day);
        return !!v && ((v.value - B) / B) * 100 >= rise;
      };
      const days = streak(asOf, above);
      if (days < cfg(c, 'night_consecutive_days')) return null;
      const cur = mean(valuesIn(map, addDays(asOf, -(days - 1)), asOf))!;
      return { metric, severity: 'info', baseline: B, current: cur, change: ((cur - B) / B) * 100, changeUnit: 'pct', days };
    }

    case 'bp_systolic': {
      // Manual readings: compared on averages (the spec's "28-day average").
      const recent = cfg(c, 'recent_window_days');
      const vals = valuesIn(map, addDays(asOf, -(recent - 1)), asOf);
      if (vals.length < cfg(c, 'bp_min_days')) return null;
      const avg = mean(vals)!;
      const baseMean = base.mean;
      if (avg - baseMean < cfg(c, 'bp_systolic_delta')) return null;
      return { metric, severity: 'warning', baseline: baseMean, current: avg, change: avg - baseMean, changeUnit: 'mmHg', days: vals.length };
    }

    case 'glucose': {
      const recent = cfg(c, 'recent_window_days');
      const vals = valuesIn(map, addDays(asOf, -(recent - 1)), asOf);
      if (vals.length < cfg(c, 'glucose_min_days') || base.mean <= 0) return null;
      const avg = mean(vals)!;
      const risePct = ((avg - base.mean) / base.mean) * 100;
      if (risePct < cfg(c, 'glucose_rise_pct')) return null;
      return { metric, severity: 'info', baseline: base.mean, current: avg, change: risePct, changeUnit: 'pct', days: vals.length };
    }
  }
}

// ---------------------------------------------------------- combining
/** Two or more metrics changing in the same week lifts each one level, capped at warning. */
export function combineSeverities(changing: Metric[], sev: Severity): Severity {
  if (changing.length >= 2 && sev === 'info') return 'warning';
  return sev;
}

/**
 * Hard guard: whatever happens upstream, Trend Watch output is never critical.
 * Anything at or above warning becomes warning; anything else becomes info.
 */
export function clampSeverity(s: string): Severity {
  return s === 'warning' || s === 'critical' ? 'warning' : 'info';
}

// --------------------------------------------------- lifecycle decisions
export type OpenFinding = {
  id: string;
  metric: Metric;
  severity: Severity;
  lastNotifiedAt: string | null; // ISO
};

export type PriorFinding = {
  metric: Metric;
  lastNotifiedAt: string | null;
  status: 'open' | 'resolved' | 'marked_expected';
};

/** True if a new finding for this metric may notify now (72-hour cooldown). */
export function cooldownClear(prior: PriorFinding | undefined, nowIso: string, c: Config): boolean {
  if (!prior || !prior.lastNotifiedAt) return true;
  const hours = (new Date(nowIso).getTime() - new Date(prior.lastNotifiedAt).getTime()) / 3_600_000;
  return hours >= cfg(c, 'cooldown_hours');
}

/** True when the last `resolve_days` days all have data inside the normal range. */
export function shouldResolve(series: DayValue[], base: Baseline, asOf: string, c: Config): boolean {
  if (base.low == null || base.high == null) return false;
  const map = byDay(series);
  const need = cfg(c, 'resolve_days');
  for (let i = 0; i < need; i++) {
    const v = map.get(addDays(asOf, -i));
    if (!v || v.value < base.low || v.value > base.high) return false;
  }
  return true;
}

/** Paused after a doctor marked a finding as expected? */
export function isPaused(pausedUntil: string | null, asOf: string): boolean {
  return !!pausedUntil && asOf <= pausedUntil;
}

export type Action =
  | { kind: 'open'; detection: Detection; notify: boolean }
  | { kind: 'update'; findingId: string; detection: Detection; escalated: boolean; notify: boolean }
  | { kind: 'resolve'; findingId: string }
  | { kind: 'none' };

/**
 * Decide what happens to one metric today, given the detection result, any
 * open finding, the most recent previous finding and the pause state.
 */
export function decide(args: {
  detection: Detection | null;
  open: OpenFinding | undefined;
  prior: PriorFinding | undefined;
  resolveNow: boolean;
  paused: boolean;
  nowIso: string;
  c: Config;
}): Action {
  const { detection, open, prior, resolveNow, paused, nowIso, c } = args;
  if (paused) return { kind: 'none' };

  if (open) {
    if (detection) {
      const escalated = open.severity === 'info' && detection.severity === 'warning';
      // An escalation is new information and always notifies. A finding that
      // opened silently inside the cooldown notifies once the cooldown ends.
      const notify = escalated || (!open.lastNotifiedAt && cooldownClear(prior, nowIso, c));
      return { kind: 'update', findingId: open.id, detection, escalated, notify };
    }
    return resolveNow ? { kind: 'resolve', findingId: open.id } : { kind: 'none' };
  }

  if (!detection) return { kind: 'none' };
  return { kind: 'open', detection, notify: cooldownClear(prior, nowIso, c) };
}
