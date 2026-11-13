// Rafiq core — TypeScript twin of ml/rafiq/core.py (layer A: daily aggregates,
// personal baselines, features; layer C: the decision). Pure functions only.
//
// It must give BIT-IDENTICAL results to the Python it was trained with
// (tests/rafiqParity.test.ts replays the fixtures and demands exact equality),
// so it uses only + − × ÷, sorting and comparisons, sums in the same order,
// and takes every constant (thresholds, floors, the EWMA weight) from model.json.
// Change the maths here only together with core.py, then retrain.

export const KIND = { heart_rate: 1, spo2: 2, skin_temperature: 3, steps: 4, movement: 5 } as const;
export const EVENT = { sos: 1, fall: 2, off_wrist: 3, on_wrist: 4, low_battery: 5, charging: 6, fall_cancelled: 7 } as const;

export const METRICS = ['hr_night', 'hr_day', 'spo2_night', 'spo2_low', 'temp_night', 'temp_day', 'steps', 'move_night', 'wear'] as const;
export type Metric = (typeof METRICS)[number];
const RELATIVE = new Set<Metric>(['steps', 'move_night']);
export const LEVELS = ['normal', 'watch', 'alert', 'urgent'] as const;
export type Level = (typeof LEVELS)[number];
const RULE_CODES = ['resting_hr_up', 'spo2_night_down', 'temp_up', 'activity_down'] as const;

export type Params = Record<string, number>;
export type Rows = { t: number[]; kind: number[]; value: number[]; resting: boolean[]; quality: number[] };
export type Events = { t: number[]; kind: number[] };
export type Agg = Record<Metric, number> & { still_awake_h: number; falls: number; fall_still_min: number };
export type Base = [number, number] | null;
export type DayFeatures = {
  features: Record<string, number>;
  vector: number[];
  z: Record<Metric, number>;
  learning: boolean;
  base: Record<Metric, Base>;
  agg: Agg;
};
export type Reason = { code: string; level: Level; days: number; params: Record<string, number | string | string[]> };
export type Decision = { level: Level; learning: boolean; reasons: Reason[] };
export type Thresholds = { alert_path: number; watch_path: number };

const NaN_ = Number.NaN;
const isNaN_ = (x: number) => x !== x;

// ------------------------------------------------------------------ helpers
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN_;
  const m = Math.floor(n / 2);
  return n % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median of all pairwise slopes, pairs in (i < j) order. */
export function theilSen(xs: number[], ys: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  }
  return median(slopes);
}

const clip = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

// ------------------------------------------------------------------ local time
const offsetCache = new Map<string, number>();
const fmtCache = new Map<string, Intl.DateTimeFormat>();

/** UTC offset (seconds) of `tz` at unix time t, read at the start of t's UTC hour (as Python does). */
export function utcOffsetSeconds(t: number, tz: string): number {
  const h = Math.floor(t / 3600);
  const key = `${tz}|${h}`;
  const hit = offsetCache.get(key);
  if (hit !== undefined) return hit;
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, fmt);
  }
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(h * 3600 * 1000))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
  const off = asUtc - h * 3600;
  offsetCache.set(key, off);
  return off;
}

/** Days since 1970-01-01 (local) of the Rafiq day (07:00 → 07:00) containing t. */
export function rafiqDayOf(t: number, tz: string, P: Params): number {
  return Math.floor((t + utcOffsetSeconds(t, tz) - P.day_start_hour * 3600) / 86400);
}

/** The UTC instant at which Rafiq day `d` starts (07:00 local). */
export function rafiqDayStart(d: number, tz: string, P: Params): number {
  let t = d * 86400 + P.day_start_hour * 3600;
  for (let i = 0; i < 3; i++) t = d * 86400 + P.day_start_hour * 3600 - utcOffsetSeconds(t, tz);
  return t;
}

// ------------------------------------------------------------------ layer A: days
export function dayAggregates(rows: Rows, events: Events, tz: string, P: Params): Map<number, Agg> {
  const n = rows.t.length;
  const out = new Map<number, Agg>();
  if (n === 0) return out;
  const day = new Array<number>(n);
  const night = new Array<boolean>(n);
  const block = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const t = rows.t[i];
    const local = t + utcOffsetSeconds(t, tz);
    const hour = Math.floor(local / 3600) % 24;
    day[i] = Math.floor((local - P.day_start_hour * 3600) / 86400);
    night[i] = hour >= P.night_start_hour || hour < P.day_start_hour;
    block[i] = Math.floor(t / 600);
  }
  const evDay = events.t.map((t) => rafiqDayOf(t, tz, P));
  const cancels = events.t.filter((_, i) => events.kind[i] === EVENT.fall_cancelled);

  let a = 0;
  while (a < n) {
    const d = day[a];
    let b = a;
    while (b < n && day[b] === d) b++;

    const hrN: number[] = [], hrD: number[] = [], spN: number[] = [], spD: number[] = [];
    const tmN: number[] = [], tmD: number[] = [];
    const worn = new Set<number>(), wornDay = new Set<number>(), wornNight = new Set<number>();
    let stepsSum = 0;
    const moveNight: number[] = [];
    const stepOf = new Map<number, number>(), moveOf = new Map<number, number>();
    for (let i = a; i < b; i++) {
      const k = rows.kind[i], v = rows.value[i], q = rows.quality[i], nt = night[i], bl = block[i];
      const good = rows.resting[i] && q >= P.min_quality && q !== 255;
      if (k === KIND.heart_rate && good) (nt ? hrN : hrD).push(v);
      else if (k === KIND.spo2 && good) (nt ? spN : spD).push(v);
      if (k === KIND.skin_temperature && (q === 255 || q >= P.min_quality)) (nt ? tmN : tmD).push(v);
      if (k === KIND.skin_temperature || k === KIND.steps || k === KIND.movement) {
        worn.add(bl);
        (nt ? wornNight : wornDay).add(bl);
      }
      if (k === KIND.steps) {
        if (!nt) stepsSum += v;
        stepOf.set(bl, v);
      }
      if (k === KIND.movement) {
        if (nt) moveNight.push(v);
        moveOf.set(bl, v);
      }
    }
    const segMedian = (vals: number[], minimum: number) => (vals.length >= minimum ? median(vals) : NaN_);
    const spSorted = [...spN].sort((x, y) => x - y);
    const spo2Low = spSorted.length >= P.min_readings_segment
      ? spSorted[Math.trunc(0.1 * (spSorted.length - 1))] : NaN_;

    const dayHours = wornDay.size / 6;
    const steps = dayHours >= P.min_wear_hours_steps ? stepsSum / dayHours : NaN_;
    let moveN = NaN_;
    if (wornNight.size >= P.min_night_blocks_move && moveNight.length) {
      let acc = 0;
      for (const x of moveNight) acc += x;
      moveN = acc / moveNight.length;
    }

    const still = (bl: number) => {
      const s = stepOf.get(bl), m = moveOf.get(bl);
      return s !== undefined && m !== undefined && s <= P.still_steps_max && m <= P.still_movement_max;
    };
    let longest = 0, run = 0, prev: number | null = null;
    for (const bl of [...wornDay].sort((x, y) => x - y)) {
      if (still(bl) && prev !== null && bl === prev + 1 && run > 0) run += 1;
      else if (still(bl)) run = 1;
      else run = 0;
      if (run > longest) longest = run;
      prev = bl;
    }

    let falls = 0, fallStill = 0;
    for (let i = 0; i < events.t.length; i++) {
      if (evDay[i] !== d || events.kind[i] !== EVENT.fall) continue;
      const ft = events.t[i];
      if (cancels.some((c) => ft <= c && c <= ft + P.fall_cancel_seconds)) continue;
      falls += 1;
      let nStill = 0;
      let bl = Math.floor(ft / 600) + 1;
      while (nStill < P.fall_still_cap_blocks && worn.has(bl) && still(bl)) {
        nStill += 1;
        bl += 1;
      }
      if (nStill > fallStill) fallStill = nStill;
    }

    out.set(d, {
      hr_night: segMedian(hrN, P.min_readings_segment), hr_day: segMedian(hrD, P.min_readings_segment),
      spo2_night: segMedian(spN, P.min_readings_segment), spo2_low: spo2Low,
      temp_night: segMedian(tmN, P.min_temp_blocks), temp_day: segMedian(tmD, P.min_temp_blocks),
      steps, move_night: moveN, wear: worn.size / 6,
      still_awake_h: longest / 6, falls, fall_still_min: fallStill * 10,
    });
    a = b;
  }
  return out;
}

// ------------------------------------------------------------------ baselines + features
export function baseline(series: Map<number, Agg>, metric: Metric, d: number, P: Params): Base {
  const lo = d - P.recent_days - P.baseline_days + 1;
  const hi = d - P.recent_days;
  const vals: number[] = [];
  for (let x = lo; x <= hi; x++) {
    const s = series.get(x);
    if (s && !isNaN_(s[metric])) vals.push(s[metric]);
  }
  if (vals.length < P.baseline_min_days) return null;
  const med = median(vals);
  let mad: number;
  if (RELATIVE.has(metric)) {
    if (med <= 0) return null;
    mad = median(vals.map((x) => Math.abs(x / med - 1.0)));
  } else {
    mad = median(vals.map((x) => Math.abs(x - med)));
  }
  const sd = P.mad_scale * mad;
  const fl = P[`floor_${metric}`];
  return [med, sd > fl ? sd : fl];
}

function zscore(series: Map<number, Agg>, metric: Metric, d: number, base: Base, P: Params): number {
  const s = series.get(d);
  if (base === null || !s) return NaN_;
  const x = s[metric];
  if (isNaN_(x)) return NaN_;
  const [med, sd] = base;
  const z = RELATIVE.has(metric) ? (x / med - 1.0) / sd : (x - med) / sd;
  return clip(z, -P.z_clip, P.z_clip);
}

function isLearning(series: Map<number, Agg>, d: number, P: Params): boolean {
  let worn = 0;
  for (let x = d - P.recent_days - P.baseline_days + 1; x < d; x++) {
    const s = series.get(x);
    if (s && s.wear >= P.min_wear_hours_day) worn += 1;
  }
  return worn < P.learning_min_days;
}

function slope(zs: Map<number, number>, d: number, days: number, minimum: number): number {
  const xs: number[] = [], ys: number[] = [];
  for (let x = d - days + 1; x <= d; x++) {
    const z = zs.get(x);
    if (z !== undefined && !isNaN_(z)) {
      xs.push(x);
      ys.push(z);
    }
  }
  return xs.length >= minimum ? theilSen(xs, ys) : NaN_;
}

function ewma(zs: Map<number, number>, d: number, alpha: number, P: Params): number {
  let e = NaN_;
  for (let x = d - P.ewma_days + 1; x <= d; x++) {
    const z = zs.get(x);
    if (z === undefined || isNaN_(z)) continue;
    e = isNaN_(e) ? z : e + alpha * (z - e);
  }
  return e;
}

export function elderFeatures(series: Map<number, Agg>, features: string[], P: Params, alpha: number): Map<number, DayFeatures> {
  const days = [...series.keys()].sort((x, y) => x - y);
  const zs = Object.fromEntries(METRICS.map((m) => [m, new Map<number, number>()])) as Record<Metric, Map<number, number>>;
  const bases = new Map<number, Record<Metric, Base>>();
  for (const d of days) {
    const b = {} as Record<Metric, Base>;
    for (const m of METRICS) {
      b[m] = baseline(series, m, d, P);
      zs[m].set(d, zscore(series, m, d, b[m], P));
    }
    bases.set(d, b);
  }
  const out = new Map<number, DayFeatures>();
  for (const d of days) {
    const s = series.get(d)!;
    const z = {} as Record<Metric, number>;
    for (const m of METRICS) z[m] = zs[m].get(d)!;
    const f: Record<string, number> = {
      z_hr_night: z.hr_night, z_hr_day: z.hr_day, z_spo2_night: z.spo2_night, z_spo2_low: z.spo2_low,
      z_temp_night: z.temp_night, z_temp_day: z.temp_day, z_steps: z.steps, z_move_night: z.move_night, z_wear: z.wear,
      still_awake_h: s.still_awake_h, fall_still_h: s.fall_still_min / 60,
      slope7_hr_night: slope(zs.hr_night, d, P.slope_short_days, P.slope_short_min),
      slope30_hr_night: slope(zs.hr_night, d, P.slope_long_days, P.slope_long_min),
      slope7_spo2_night: slope(zs.spo2_night, d, P.slope_short_days, P.slope_short_min),
      slope7_temp_night: slope(zs.temp_night, d, P.slope_short_days, P.slope_short_min),
      slope7_steps: slope(zs.steps, d, P.slope_short_days, P.slope_short_min),
      ewma_hr_night: ewma(zs.hr_night, d, alpha, P),
      ewma_temp_night: ewma(zs.temp_night, d, alpha, P),
    };
    const zh = !isNaN_(z.hr_night) ? z.hr_night : z.hr_day;
    const zt = !isNaN_(z.temp_night) ? z.temp_night : z.temp_day;
    const lo = zh < zt ? zh : zt;
    f.hr_temp_joint = isNaN_(zh) || isNaN_(zt) ? 0.0 : lo < 0 ? 0.0 : lo;
    f.missing_frac = 1.0 - (s.wear < 24 ? s.wear / 24 : 1.0);
    const vector = features.map((name) => (isNaN_(f[name]) ? 0.0 : f[name]));
    out.set(d, { features: f, vector, z, learning: isLearning(series, d, P), base: bases.get(d)!, agg: s });
  }
  return out;
}

// ------------------------------------------------------------------ layer C: decide
type Signal = { on: boolean; strong: boolean; deep?: boolean; params: Record<string, number | string> } | null;

function ruleSignals(F: DayFeatures, C: Params): Record<(typeof RULE_CODES)[number], Signal> {
  const { agg, base, z } = F;
  const out = {} as Record<(typeof RULE_CODES)[number], Signal>;

  let m: Metric = !isNaN_(z.hr_night) ? 'hr_night' : 'hr_day';
  let b = base[m];
  if (isNaN_(z[m]) || b === null) out.resting_hr_up = null;
  else {
    const delta = agg[m] - b[0];
    const on = z[m] >= C.watch_z && delta >= C.hr_min_delta;
    out.resting_hr_up = {
      on, strong: on && z[m] >= C.alert_z && delta >= C.hr_strong_delta,
      params: { delta, usual: b[0], value: agg[m], z: z[m], part: m },
    };
  }

  const bm = base.spo2_night, bl = base.spo2_low;
  const haveMed = !isNaN_(z.spo2_night) && bm !== null;
  const haveLow = !isNaN_(z.spo2_low) && bl !== null;
  if (!haveMed && !haveLow) out.spo2_night_down = null;
  else {
    const drop = haveMed ? bm![0] - agg.spo2_night : NaN_;
    const lowDrop = haveLow ? bl![0] - agg.spo2_low : NaN_;
    const onMed = haveMed && z.spo2_night <= -C.watch_z && drop >= C.spo2_min_drop;
    const onLow = haveLow && z.spo2_low <= -C.watch_z && lowDrop >= C.spo2_low_min_drop;
    out.spo2_night_down = {
      on: onMed || onLow, strong: onMed && drop >= C.spo2_strong_drop,
      params: { drop, low_drop: lowDrop, usual: haveMed ? bm![0] : NaN_, value: agg.spo2_night },
    };
  }

  m = !isNaN_(z.temp_night) ? 'temp_night' : 'temp_day';
  b = base[m];
  if (isNaN_(z[m]) || b === null) out.temp_up = null;
  else {
    const delta = agg[m] - b[0];
    out.temp_up = {
      on: z[m] >= C.watch_z && delta >= C.temp_min_delta, strong: false,
      params: { delta, usual: b[0], value: agg[m] },
    };
  }

  const bs = base.steps;
  if (isNaN_(agg.steps) || bs === null) out.activity_down = null;
  else {
    const ratio = agg.steps / bs[0];
    out.activity_down = {
      on: ratio <= C.activity_watch_ratio, strong: ratio <= C.activity_alert_ratio, deep: ratio <= C.activity_deep_ratio,
      params: { ratio, usual: bs[0], value: agg.steps },
    };
  }
  return out;
}

const rank = (l: Level) => LEVELS.indexOf(l);

/** Day-by-day verdicts. paths: mean isolation path per day (lower = more unusual). */
export function decideElder(
  feats: Map<number, DayFeatures>, paths: Map<number, number> | null, thresholds: Thresholds | null,
  C: Params, featureNames: string[], useRules = true,
): Map<number, Decision> {
  const runs: Record<string, number> = Object.fromEntries(RULE_CODES.map((c) => [c, 0]));
  const act = { strong: 0, deep: 0 };
  const modelRuns = { watch: 0, alert: 0 };
  const out = new Map<number, Decision>();
  for (const d of [...feats.keys()].sort((x, y) => x - y)) {
    const F = feats.get(d)!;
    const sig = ruleSignals(F, C);
    let reasons: Reason[] = [];
    for (const code of useRules ? RULE_CODES : []) {
      const s = sig[code];
      if (s === null) continue; // no data today: the run carries over
      runs[code] = s.on ? runs[code] + 1 : 0;
      if (code === 'activity_down') {
        act.strong = s.strong ? act.strong + 1 : 0;
        act.deep = s.deep ? act.deep + 1 : 0;
      }
      if (!s.on) continue;
      const r = runs[code];
      let level: Level | null = null;
      if (code === 'temp_up') {
        const hr = sig.resting_hr_up;
        if (hr !== null && hr.on) level = 'alert';
        else if (r >= C.watch_min_days) level = 'watch';
      } else if (code === 'activity_down') {
        if (act.deep >= C.watch_min_days || act.strong >= C.activity_alert_days) level = 'alert';
        else if (r >= C.watch_min_days) level = 'watch';
      } else {
        if (r >= C.alert_min_days || (r >= C.watch_min_days && s.strong)) level = 'alert';
        else if (r >= C.watch_min_days) level = 'watch';
      }
      if (level) reasons.push({ code, level, days: r, params: { ...s.params } });
    }

    const { agg, base } = F;
    if (useRules) {
      if (!isNaN_(agg.spo2_night) && agg.spo2_night <= C.urgent_night_spo2_median && base.hr_night !== null
          && !isNaN_(agg.hr_night) && agg.hr_night - base.hr_night[0] >= C.urgent_night_hr_rise_bpm) {
        reasons.push({ code: 'spo2_low_hr_high', level: 'urgent', days: 1,
          params: { spo2: agg.spo2_night, hr_rise: agg.hr_night - base.hr_night[0] } });
      }
      if (agg.still_awake_h >= C.urgent_inactive_awake_hours) {
        reasons.push({ code: 'inactive_awake', level: 'urgent', days: 1, params: { hours: agg.still_awake_h } });
      }
      if (agg.falls > 0 && agg.fall_still_min >= C.fall_still_minutes) {
        reasons.push({ code: 'fall_then_still', level: 'alert', days: 1, params: { minutes: agg.fall_still_min } });
      }
    }

    if (paths !== null && thresholds !== null && paths.has(d)) {
      const p = paths.get(d)!;
      const hitAlert = p <= thresholds.alert_path;
      const hitWatch = p <= thresholds.watch_path;
      modelRuns.alert = hitAlert ? modelRuns.alert + 1 : 0;
      modelRuns.watch = hitWatch ? modelRuns.watch + 1 : 0;
      if (hitAlert) {
        for (const r of reasons) {
          if (r.level === 'watch' && r.code !== 'temp_up') {
            r.level = 'alert';
            r.params.model = 1;
          }
        }
      }
      if (reasons.length === 0) {
        let level: Level | null = null;
        if (modelRuns.alert >= 2) level = 'alert';
        else if (hitAlert || modelRuns.watch >= 2) level = 'watch';
        if (level) {
          // Python: sorted(((abs(v), name) …), reverse=True)[:2] — ties broken by name, descending.
          const top = featureNames.slice(0, 9).map((name, i) => [Math.abs(F.vector[i]), name] as const)
            .sort((x, y) => (y[0] - x[0]) || (y[1] < x[1] ? -1 : y[1] > x[1] ? 1 : 0))
            .slice(0, 2).map((x) => x[1]);
          reasons.push({ code: 'unusual_pattern', level, days: Math.max(1, modelRuns.watch), params: { top } });
        }
      }
    }

    if (F.learning) reasons = [];
    let level: Level = 'normal';
    for (const r of reasons) if (rank(r.level) > rank(level)) level = r.level;
    out.set(d, { level, learning: F.learning, reasons });
  }
  return out;
}
