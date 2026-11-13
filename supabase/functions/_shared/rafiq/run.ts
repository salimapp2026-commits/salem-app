// Rafiq: score one elder for one Rafiq day and act on it. Storage is passed in
// (RafiqStore), so the same code runs in the edge function (Supabase) and in
// the end-to-end test (in memory).
//
// For day D (07:00 local on D → 07:00 on D+1: the day plus the night after it):
//   1. read the band rows and events of the last 65 days (baselines need D-34…
//      D-7; the 30-day slope needs baselines for each of its days)
//   2. layer A → features → Isolation Forest path → layer C decision
//   3. store the person's normal (rafiq_baselines) and the verdict (rafiq_scores)
//   4. for each reason: rafiq_raise() — the database applies the rate limit and
//      pushes (watch in-app only; alert / urgent to caregivers with read-health
//      and linked doctors; never a location)
//   5. close alerts whose reason has been gone for resolve_days days
//
// Two things are deliberately NOT pushed again by Rafiq, only shown in the app:
//   • a fall the band already pushed in real time (fall_detected alert that day)
//   • a change Trend Watch already pushed for the same reading in the last 72 h
// Intraday ("today so far") passes only ever raise urgent reasons: a half day
// is not enough to judge a trend.
import {
  type Decision, type Events, type Level, type Reason, type Rows,
  dayAggregates, decideElder, elderFeatures, LEVELS, METRICS, rafiqDayStart,
} from './core.ts';
import { anomalyScore, meanPath } from './forest.ts';
import type { RafiqModel } from './model.ts';
import { alertText, pushTitle, reasonText } from './text.ts';

export type Elder = { elder_id: string; display_name: string; timezone: string };

export type RaiseArgs = {
  p_elder: string; p_level: Level; p_reason_code: string; p_metrics: string[]; p_params: Record<string, unknown>;
  p_reason_en: string; p_reason_ar: string; p_title_en: string; p_title_ar: string;
  p_scored_for: string; p_score_id: string | null; p_days: number;
  /** when this happens: now on the daily pass, the simulated morning on a replay */
  p_now: string;
};

export interface RafiqStore {
  bandRows(elderId: string, fromUnix: number, toUnix: number): Promise<Rows>;
  bandEvents(elderId: string, fromUnix: number, toUnix: number): Promise<Events>;
  /** kinds of real-time alerts raised for the elder in [from, to) — to avoid pushing a fall twice */
  realtimeAlertKinds(elderId: string, fromIso: string, toIso: string): Promise<string[]>;
  /** Trend Watch metrics pushed for the elder since `sinceIso` */
  trendNotifiedMetrics(elderId: string, sinceIso: string): Promise<string[]>;
  openAlerts(elderId: string): Promise<{ id: string; reason_code: string }[]>;
  upsertBaselines(rows: Record<string, unknown>[]): Promise<void>;
  upsertScore(row: Record<string, unknown>): Promise<string | null>;
  raise(args: RaiseArgs): Promise<Record<string, unknown>>;
  resolve(rafiqAlertId: string, nowIso: string): Promise<void>;
}

export const HISTORY_DAYS = 65;

/** rafiq_config keys that change how Rafiq learns and decides, each with the range it may take
 *  (founder, 2026-10-31: everything changeable lives on the server). Seeded (step30c) with the
 *  model's own values, so they change nothing until someone edits them. Other keys: ignored here.
 *  For the beta: learning_min_days 7, recent_days 2 → Rafiq speaks from about day 9, not 14. */
export const CONFIG_PARAMS: Record<string, [number, number]> = {
  learning_min_days: [3, 28],
  recent_days: [1, 7],
  min_wear_hours_day: [4, 20],
};
export const CONFIG_DECIDE: Record<string, [number, number]> = {
  watch_z: [1, 5],
  alert_z: [1.5, 6],
  watch_min_days: [1, 7],
  alert_min_days: [1, 14],
  urgent_night_spo2_median: [80, 94],
  urgent_night_hr_rise_bpm: [5, 40],
  urgent_inactive_awake_hours: [3, 12],
};

/** The model with rafiq_config applied: whitelisted keys inside their range, and use_model. */
export function withConfig(model: RafiqModel, cfg: Record<string, number>): RafiqModel {
  const apply = (base: Record<string, number>, allowed: Record<string, [number, number]>) => {
    const out = { ...base };
    for (const [k, [lo, hi]] of Object.entries(allowed)) {
      const v = cfg[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) out[k] = v;
    }
    return out;
  };
  return {
    ...model,
    params: apply(model.params, CONFIG_PARAMS) as RafiqModel['params'],
    decide: apply(model.decide, CONFIG_DECIDE) as RafiqModel['decide'],
    use_model: cfg.use_model === undefined ? model.use_model : cfg.use_model !== 0,
  };
}

/** Wrap a store so band rows and events are read ONCE for [fromUnix, toUnix) and then
 *  served from memory — a replay of 60 days would otherwise read 65 days of rows 60 times. */
export async function preloadBand(store: RafiqStore, elderId: string, fromUnix: number, toUnix: number): Promise<RafiqStore> {
  const [rows, events] = await Promise.all([store.bandRows(elderId, fromUnix, toUnix), store.bandEvents(elderId, fromUnix, toUnix)]);
  const pick = <T extends { t: number[] }>(src: T, a: number, b: number): T => {
    const idx: number[] = [];
    for (let i = 0; i < src.t.length; i++) if (src.t[i] >= a && src.t[i] < b) idx.push(i);
    return Object.fromEntries(Object.entries(src).map(([k, v]) => [k, idx.map((i) => (v as unknown[])[i])])) as T;
  };
  return {
    ...store,
    bandRows: async (_e, a, b) => pick(rows, a, b),
    bandEvents: async (_e, a, b) => pick(events, a, b),
  };
}
const TREND_METRIC: Record<string, string> = {
  resting_hr_up: 'resting_hr', spo2_night_down: 'spo2', temp_up: 'skin_temp', activity_down: 'activity',
};
// One story, one push: a reason is not pushed on its own while a reason that
// already tells it is there (the fever text says "together with a higher resting
// heart rate"; the urgent oxygen text names both). It is still stored and shown.
const TOLD_BY: Record<string, string[]> = {
  resting_hr_up: ['temp_up', 'spo2_low_hr_high'],
  spo2_night_down: ['spo2_low_hr_high'],
};
const REASON_METRICS: Record<string, string[]> = {
  resting_hr_up: ['resting_hr'], spo2_night_down: ['spo2'], temp_up: ['skin_temp', 'resting_hr'],
  activity_down: ['activity'], spo2_low_hr_high: ['spo2', 'resting_hr'], inactive_awake: ['activity'],
  fall_then_still: ['activity'], unusual_pattern: [],
};

export const firstName = (n: string) => (n || '').trim().split(/\s+/)[0] || 'Your family member';
export const dayString = (d: number) => new Date(d * 86400 * 1000).toISOString().slice(0, 10);
export const dayIndex = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);

const nn = (x: unknown): unknown => {
  if (typeof x === 'number' && x !== x) return null;
  if (Array.isArray(x)) return x.map(nn);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, nn(v)]));
  return x;
};

export type ScoreResult = {
  elder: string; day: string; status: 'scored' | 'no_data';
  level?: Level; learning?: boolean; score?: number; reasons?: string[];
  raised?: Record<string, unknown>[]; resolved?: string[];
};

/** Everything Rafiq knows about one elder up to day `d`: decisions for each day in the window. */
export async function analyse(store: RafiqStore, model: RafiqModel, elder: Elder, d: number, endUnix?: number) {
  const P = model.params;
  const from = rafiqDayStart(d - HISTORY_DAYS + 1, elder.timezone, P);
  const to = endUnix ?? rafiqDayStart(d + 1, elder.timezone, P);
  const [rows, events] = await Promise.all([
    store.bandRows(elder.elder_id, from, to),
    store.bandEvents(elder.elder_id, from, to),
  ]);
  const agg = dayAggregates(rows, events, elder.timezone, P);
  const feats = elderFeatures(agg, model.features, P, model.ewma_alpha);
  const paths = new Map([...feats].map(([day, f]) => [day, meanPath(model.forest, f.vector)]));
  const decisions = decideElder(feats, model.use_model === false ? null : paths, model.thresholds, model.decide, model.features);
  return { feats, paths, decisions, from, to };
}

export async function scoreElderDay(
  store: RafiqStore, model: RafiqModel, elder: Elder, d: number,
  opts: { scope: 'day' | 'intraday'; notify: boolean; nowUnix: number; resolveDays: number },
): Promise<ScoreResult> {
  const P = model.params;
  const day = dayString(d);
  const end = opts.scope === 'intraday' ? opts.nowUnix : undefined;
  const { feats, paths, decisions, to } = await analyse(store, model, elder, d, end);
  const F = feats.get(d);
  const dec = decisions.get(d);
  if (!F || !dec) return { elder: elder.elder_id, day, status: 'no_data' };

  const dayStart = rafiqDayStart(d, elder.timezone, P);
  const iso = (u: number) => new Date(u * 1000).toISOString();

  // ---- the person's normal
  await store.upsertBaselines(METRICS.map((m) => {
    const b = F.base[m];
    const relative = m === 'steps' || m === 'move_night';
    let low: number | null = null, high: number | null = null;
    if (b) {
      low = relative ? Math.max(0, b[0] * (1 - 2 * b[1])) : b[0] - 2 * b[1];
      high = relative ? b[0] * (1 + 2 * b[1]) : b[0] + 2 * b[1];
    }
    return {
      elder_id: elder.elder_id, metric: m, median: b ? b[0] : null, robust_sd: b ? b[1] : null, relative,
      low, high, learning: F.learning, computed_for: day, model_version: model.version,
      updated_at: iso(opts.nowUnix),
    };
  }));

  // ---- the verdict
  const name = firstName(elder.display_name);
  const path = paths.get(d)!;
  const reasonsOut = dec.reasons.map((r) => ({
    code: r.code, level: r.level, days: r.days, params: nn(r.params),
    // shown together on the Rafiq screen, which adds the closing note once
    en: reasonText(r, name, 'en'), ar: reasonText(r, name, 'ar'),
  }));
  const scoreId = await store.upsertScore({
    elder_id: elder.elder_id, scope: opts.scope, scored_for: day,
    window_start: iso(dayStart), window_end: iso(to),
    level: dec.level, learning: dec.learning,
    model_score: anomalyScore(model.forest, path), model_version: model.version,
    features: nn(F.features), deviations: nn({ z: F.z, agg: F.agg, base: F.base, path }),
    reasons: reasonsOut,
  });

  const result: ScoreResult = {
    elder: elder.elder_id, day, status: 'scored', level: dec.level, learning: dec.learning,
    score: anomalyScore(model.forest, path), reasons: dec.reasons.map((r) => r.code), raised: [], resolved: [],
  };
  if (!opts.notify || dec.learning) return result;

  // ---- act on each reason
  const realtime = await store.realtimeAlertKinds(elder.elder_id, iso(dayStart), iso(to));
  const trendRecent = await store.trendNotifiedMetrics(elder.elder_id, iso(opts.nowUnix - 72 * 3600));
  for (const r of dec.reasons) {
    if (opts.scope === 'intraday' && r.level !== 'urgent') continue;
    const teller = dec.reasons.find((o) => (TOLD_BY[r.code] ?? []).includes(o.code) && levelRank(o.level) >= levelRank(r.level));
    if (teller) {
      result.raised!.push({ code: r.code, skipped: `told_by_${teller.code}` });
      continue;
    }
    let level: Level = r.level;
    const params: Record<string, unknown> = { ...(nn(r.params) as Record<string, unknown>) };
    if (r.code === 'fall_then_still' && realtime.includes('fall_detected')) {
      level = 'watch';                       // the band already pushed this fall in real time
      params.deferred = 'band_fall_alert';
    }
    const tm = TREND_METRIC[r.code];
    if (tm && trendRecent.includes(tm) && (level === 'watch' || level === 'alert')) {
      level = 'watch';                       // Trend Watch already pushed about this reading
      params.deferred = 'trend_watch_notified';
    }
    const shown: Reason = { ...r, level };
    result.raised!.push(await store.raise({
      p_elder: elder.elder_id, p_level: level, p_reason_code: r.code,
      p_metrics: REASON_METRICS[r.code] ?? [], p_params: params,
      p_reason_en: alertText(shown, name, 'en'), p_reason_ar: alertText(shown, name, 'ar'),
      p_title_en: pushTitle(level, name, 'en'), p_title_ar: pushTitle(level, name, 'ar'),
      p_scored_for: day, p_score_id: scoreId, p_days: r.days, p_now: iso(opts.nowUnix),
    }));
  }

  // ---- close what has settled (only on the daily pass)
  if (opts.scope === 'day') {
    const recent: Decision[] = [];
    for (let x = d - opts.resolveDays + 1; x <= d; x++) {
      const dd = decisions.get(x);
      if (dd) recent.push(dd);
    }
    for (const a of await store.openAlerts(elder.elder_id)) {
      const stillThere = recent.some((dd) => dd.reasons.some((r) => r.code === a.reason_code));
      if (!stillThere && recent.length >= opts.resolveDays) {
        await store.resolve(a.id, iso(opts.nowUnix));
        result.resolved!.push(a.reason_code);
      }
    }
  }
  return result;
}

export const levelRank = (l: Level) => LEVELS.indexOf(l);
