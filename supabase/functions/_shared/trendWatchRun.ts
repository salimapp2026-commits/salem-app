// Trend Watch, the daily rules engine — now run by Rafiq's daily pass
// (rafiq-score, 07:00 Cairo) and still by the trend-watch function for replays.
//
// Moved here unchanged from supabase/functions/trend-watch/index.ts (step 2 of
// docs/RAFIQ_ML_PLAN.md: "merge Trend Watch into Rafiq, keeping its tested rules
// and thresholds"). The rules, thresholds (trend_config), 14-day learning,
// 72-hour cooldown, templates and push routing are exactly as before; the only
// change since step 1 is that no outside AI is ever called.
import {
  type Baseline,
  type Config,
  type DayValue,
  type Detection,
  type OpenFinding,
  type PriorFinding,
  addDays,
  clampSeverity,
  combineSeverities,
  computeBaseline,
  decide,
  detect,
  isPaused,
  mean,
  shouldResolve,
} from './trendRules.ts';
import {
  type FindingFacts,
  type Lang,
  METRICS,
  type Metric,
  type WeeklyMetricNumbers,
  findingTemplate,
  nextStepsFor,
  pushTitle,
  settledTemplate,
  weeklyTemplate,
  withDisclaimer,
} from './trendText.ts';


// deno-lint-ignore no-explicit-any
export type Admin = any;

/** Yesterday's date in a timezone, as YYYY-MM-DD. */
export function yesterdayIn(tz: string, now = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now);
  return addDays(today, -1);
}

function firstName(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || name;
}

// ------------------------------------------------------------- notifications
async function notify(
  admin: Admin,
  args: {
    elderId: string;
    severity: 'info' | 'warning';
    sourceKind: string;
    sourceId: string;
    texts: Record<Lang, { title: string; body: string }>;
    excludeRoles?: string[];
    inAppOnly?: boolean;
  },
) {
  try {
    const r = await admin.functions.invoke('notify-fanout', {
      body: {
        elder_id: args.elderId,
        severity: clampSeverity(args.severity),
        source_kind: args.sourceKind,
        source_id: args.sourceId,
        // Legacy single-language fields, still required by notify-fanout.
        title_ar: args.texts.en.title,
        body_ar: args.texts.en.body,
        texts: args.texts,
        recipients: 'trend',
        exclude_roles: args.excludeRoles ?? [],
        in_app_only: args.inAppOnly ?? false,
      },
    });
    return r.data ?? r.error?.message ?? null;
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}

// -------------------------------------------------------------- one elder
export type Elder = { elder_id: string; display_name: string; timezone: string; locale: string | null };
export type RunCtx = { admin: Admin; c: Config; notifyEnabled: boolean };

export async function loadConfig(admin: Admin): Promise<Config> {
  const { data } = await admin.from('trend_config').select('key, value');
  const c: Config = {};
  for (const row of (data ?? []) as { key: string; value: number }[]) c[row.key] = Number(row.value);
  return c;
}

async function loadSeries(admin: Admin, elderId: string, from: string, to: string) {
  const { data, error } = await admin
    .from('vital_daily_summaries')
    .select('metric, day, value, enough')
    .eq('elder_id', elderId)
    .gte('day', from)
    .lte('day', to)
    .order('day');
  if (error) throw new Error(`summaries: ${error.message}`);
  const by = new Map<Metric, DayValue[]>();
  for (const r of (data ?? []) as { metric: Metric; day: string; value: number; enough: boolean }[]) {
    if (!by.has(r.metric)) by.set(r.metric, []);
    by.get(r.metric)!.push({ day: r.day, value: Number(r.value), enough: r.enough });
  }
  return by;
}

export async function processElder(ctx: RunCtx, elder: Elder, asOf: string, nowIso: string, refresh = true) {
  const { admin, c } = ctx;
  const name = firstName(elder.display_name);

  if (refresh) {
    const { error } = await admin.rpc('refresh_vital_daily_summaries', {
      p_elder: elder.elder_id,
      p_from: addDays(asOf, -2),
      p_to: asOf,
    });
    if (error) throw new Error(`refresh: ${error.message}`);
  }

  const [series, baseRows, openRows, priorRows] = await Promise.all([
    loadSeries(admin, elder.elder_id, addDays(asOf, -69), asOf),
    admin.from('trend_baselines').select('metric, reset_at, paused_until').eq('elder_id', elder.elder_id),
    admin.from('trend_findings').select('id, metric, severity, last_notified_at, alert_id')
      .eq('elder_id', elder.elder_id).eq('status', 'open'),
    admin.from('trend_findings').select('metric, status, last_notified_at, opened_at')
      .eq('elder_id', elder.elder_id).neq('status', 'open').order('opened_at', { ascending: false }).limit(50),
  ]);

  const stored = new Map<string, { reset_at: string | null; paused_until: string | null }>(
    ((baseRows.data ?? []) as { metric: string; reset_at: string | null; paused_until: string | null }[])
      .map((b) => [b.metric, b]),
  );
  const open = new Map<string, OpenFinding & { alertId: string | null }>(
    ((openRows.data ?? []) as { id: string; metric: Metric; severity: 'info' | 'warning'; last_notified_at: string | null; alert_id: string | null }[])
      .map((f) => [f.metric, { id: f.id, metric: f.metric, severity: f.severity, lastNotifiedAt: f.last_notified_at, alertId: f.alert_id }]),
  );
  const prior = new Map<string, PriorFinding>();
  for (const p of (priorRows.data ?? []) as { metric: Metric; status: PriorFinding['status']; last_notified_at: string | null }[]) {
    if (!prior.has(p.metric)) prior.set(p.metric, { metric: p.metric, status: p.status, lastNotifiedAt: p.last_notified_at });
  }

  // Baselines first (also needed for the skin-temperature + HR combination).
  const baselines = new Map<Metric, Baseline>();
  for (const metric of METRICS) {
    const s = series.get(metric);
    if (!s || s.length === 0) continue;
    const resetAt = stored.get(metric)?.reset_at ?? null;
    baselines.set(metric, computeBaseline(metric, s, asOf, c, resetAt));
  }

  for (const [metric, b] of baselines) {
    const keep = stored.get(metric);
    await admin.from('trend_baselines').upsert({
      elder_id: elder.elder_id,
      metric,
      median: b.median,
      mean: b.mean,
      mad: b.mad,
      low: b.low,
      high: b.high,
      valid_days: b.validDays,
      baseline_days: b.baselineDays,
      learning: b.learning,
      learning_day: b.learningDay,
      reset_at: keep?.reset_at ?? null,
      paused_until: keep?.paused_until ?? null,
      computed_for: asOf,
      updated_at: nowIso,
    });
  }

  // Detect.
  const detections = new Map<Metric, Detection>();
  for (const [metric, b] of baselines) {
    if (isPaused(stored.get(metric)?.paused_until ?? null, asOf)) continue;
    const d = detect(metric, series.get(metric)!, b, asOf, c, baselines.get('resting_hr'), series.get('resting_hr'));
    if (d) detections.set(metric, d);
  }
  const changing = [...detections.keys()];

  const results: unknown[] = [];
  for (const [metric, b] of baselines) {
    const raw = detections.get(metric) ?? null;
    const detection = raw
      ? { ...raw, severity: clampSeverity(combineSeverities(changing, raw.severity)) }
      : null;
    const combined = !!raw && detection!.severity !== raw.severity;
    const action = decide({
      detection,
      open: open.get(metric),
      prior: prior.get(metric),
      resolveNow: shouldResolve(series.get(metric)!, b, asOf, c),
      paused: isPaused(stored.get(metric)?.paused_until ?? null, asOf),
      nowIso,
      c,
    });

    if (action.kind === 'none') continue;

    if (action.kind === 'resolve') {
      const f = open.get(metric)!;
      await admin.from('trend_findings')
        .update({ status: 'resolved', resolved_at: nowIso, updated_at: nowIso })
        .eq('id', f.id);
      if (f.alertId) await admin.from('health_alerts').update({ resolved_at: nowIso }).eq('id', f.alertId);
      const texts = {
        en: { title: pushTitle(metric, 'en'), body: withDisclaimer(settledTemplate(metric, name, 'en'), 'en') },
        ar: { title: pushTitle(metric, 'ar'), body: withDisclaimer(settledTemplate(metric, name, 'ar'), 'ar') },
      };
      const sent = ctx.notifyEnabled
        ? await notify(admin, { elderId: elder.elder_id, severity: f.severity, sourceKind: 'trend_resolved', sourceId: f.id, texts })
        : 'skipped';
      results.push({ metric, action: 'resolved', sent });
      continue;
    }

    const det = action.detection;
    const facts: FindingFacts = {
      metric, name, baseline: det.baseline, current: det.current, change: det.change, days: det.days,
    };
    const steps = nextStepsFor(metric, det.severity);
    const pushTexts = {
      en: { title: pushTitle(metric, 'en'), body: withDisclaimer(findingTemplate(facts, 'en'), 'en') },
      ar: { title: pushTitle(metric, 'ar'), body: withDisclaimer(findingTemplate(facts, 'ar'), 'ar') },
    };

    let findingId: string;
    let shouldNotify: boolean;
    let escalated = false;

    if (action.kind === 'open') {
      const { data: inserted, error } = await admin.from('trend_findings').insert({
        elder_id: elder.elder_id,
        metric,
        severity: det.severity,
        baseline_value: det.baseline,
        current_value: det.current,
        change_value: det.change,
        change_unit: det.changeUnit,
        days: det.days,
        combined,
        explanation_en: pushTexts.en.body,
        explanation_ar: pushTexts.ar.body,
        next_steps: steps,
        ai_used: false,
        opened_for: asOf,
        opened_at: nowIso,
        updated_at: nowIso,
      }).select('id').single();
      if (error) throw new Error(`finding insert: ${error.message}`);
      findingId = inserted.id;
      shouldNotify = action.notify;
    } else {
      findingId = action.findingId;
      escalated = action.escalated;
      shouldNotify = action.notify;
      await admin.from('trend_findings').update({
        severity: det.severity,
        current_value: det.current,
        change_value: det.change,
        days: det.days,
        combined,
        next_steps: steps,
        updated_at: nowIso,
        // The template text is kept current (day count, latest values).
        explanation_en: pushTexts.en.body,
        explanation_ar: pushTexts.ar.body,
        ai_used: false,
      }).eq('id', findingId);
    }

    // A new or escalated finding gets its own alert row. Only the metric name
    // goes in the payload: health_alerts is visible to every circle member,
    // details stay in the read-health-protected trend_findings.
    if (action.kind === 'open' || escalated) {
      const { data: alert } = await admin.from('health_alerts').insert({
        elder_id: elder.elder_id,
        kind: 'trend',
        severity: det.severity,
        payload: { no_fanout: true, source: 'trend_watch', finding_id: findingId, metric },
        created_at: nowIso,
      }).select('id').single();
      if (alert?.id) await admin.from('trend_findings').update({ alert_id: alert.id }).eq('id', findingId);
    }

    let sent: unknown = 'not_notified';
    if (shouldNotify && ctx.notifyEnabled) {
      sent = await notify(admin, {
        elderId: elder.elder_id, severity: det.severity, sourceKind: 'trend', sourceId: findingId, texts: pushTexts,
      });
      await admin.from('trend_findings').update({ last_notified_at: nowIso }).eq('id', findingId);
    } else if (shouldNotify) {
      await admin.from('trend_findings').update({ last_notified_at: nowIso }).eq('id', findingId);
      sent = 'skipped (notify off)';
    }

    results.push({ metric, action: action.kind, severity: det.severity, combined, escalated, notified: shouldNotify, sent });
  }

  return {
    elder: elder.elder_id,
    as_of: asOf,
    learning: [...baselines.values()].filter((b) => b.learning).map((b) => `${b.metric}:${b.learningDay}`),
    results,
  };
}

// ------------------------------------------------------------- weekly summary
export async function weeklyForElder(ctx: RunCtx, elder: Elder, asOf: string) {
  const { admin } = ctx;
  const name = firstName(elder.display_name);
  const series = await loadSeries(admin, elder.elder_id, addDays(asOf, -59), asOf);

  const avg = (s: DayValue[], from: string, to: string) =>
    mean(s.filter((d) => d.enough && d.day >= from && d.day <= to).map((d) => d.value));

  const rows: WeeklyMetricNumbers[] = [];
  for (const metric of METRICS) {
    const s = series.get(metric);
    if (!s) continue;
    const r = {
      metric,
      thisWeek: avg(s, addDays(asOf, -6), asOf),
      lastWeek: avg(s, addDays(asOf, -13), addDays(asOf, -7)),
      thisMonth: avg(s, addDays(asOf, -29), asOf),
      lastMonth: avg(s, addDays(asOf, -59), addDays(asOf, -30)),
    };
    if (r.thisWeek != null) rows.push(r);
  }
  if (rows.length === 0) return { elder: elder.elder_id, weekly: 'no_data' };

  const en = withDisclaimer(weeklyTemplate(name, rows, 'en'), 'en');
  const ar = withDisclaimer(weeklyTemplate(name, rows, 'ar'), 'ar');
  const weekStart = addDays(asOf, -6);

  const { data: saved, error } = await admin.from('trend_weekly_summaries').upsert(
    {
      elder_id: elder.elder_id,
      week_start: weekStart,
      metrics: rows,
      summary_en: en,
      summary_ar: ar,
      ai_used: false,
    },
    { onConflict: 'elder_id,week_start' },
  ).select('id').single();
  if (error) throw new Error(`weekly upsert: ${error.message}`);

  // Caregivers' notifications (in-app, not a push). The doctor reads it in the
  // patient file instead.
  const sent = ctx.notifyEnabled
    ? await notify(admin, {
        elderId: elder.elder_id,
        severity: 'warning', // routing only: reaches primary caretaker + family
        sourceKind: 'trend_weekly',
        sourceId: saved.id,
        texts: {
          en: { title: `${name}'s week`, body: en },
          ar: { title: `أسبوع ${name}`, body: ar },
        },
        excludeRoles: ['doctor'],
        inAppOnly: true,
      })
    : 'skipped';
  return { elder: elder.elder_id, weekly: 'saved', week_start: weekStart, sent };
}

// ------------------------------------------------------------- daily + replay
/** The daily pass for every elder with recent readings (was the cron path of trend-watch). */
export async function runTrendWatchDaily(admin: Admin, c: Config, opts: { weekly: boolean; runDate: string }) {
  const ctx: RunCtx = { admin, c, notifyEnabled: true };
  const { data: elders, error } = await admin.rpc('trend_elders_due', { p_lookback_days: 40 });
  const out: unknown[] = [];
  if (error) out.push({ error: error.message });
  for (const e of (elders ?? []) as Elder[]) {
    const { data: allowed } = await admin.rpc('has_feature', { p_elder_id: e.elder_id, p_feature: 'trend_watch' });
    if (!allowed) continue;
    const asOf = yesterdayIn(e.timezone);
    try {
      out.push(await processElder(ctx, e, asOf, new Date().toISOString()));
      if (opts.weekly) out.push(await weeklyForElder(ctx, e, asOf));
    } catch (err) {
      out.push({ elder: e.elder_id, error: String((err as Error)?.message ?? err) });
    }
  }
  await admin.from('trend_runs').update({ finished_at: new Date().toISOString(), result: { elders: out.length, out } })
    .eq('run_kind', 'daily').eq('local_date', opts.runDate);
  return out;
}

/** Testing path: one elder, day by day, in order, with a simulated clock. */
export async function runTrendWatchReplay(
  admin: Admin, c: Config, args: { elderId: string; from: string; to: string; notify: boolean },
): Promise<{ status: number; body: unknown }> {
  const { elderId, from, to } = args;
  const { data: p } = await admin.from('profiles')
    .select('id, display_name, timezone, preferred_locale').eq('id', elderId).single();
  if (!p) return { status: 404, body: { error: 'elder_not_found' } };
  const elder: Elder = {
    elder_id: p.id, display_name: p.display_name,
    timezone: p.timezone && p.timezone !== '' ? p.timezone : 'Africa/Cairo', locale: p.preferred_locale,
  };
  const ctx: RunCtx = { admin, c, notifyEnabled: args.notify };

  // Summaries for the whole range once, up front.
  const { error: refErr } = await admin.rpc('refresh_vital_daily_summaries', {
    p_elder: elderId, p_from: addDays(from, -69), p_to: to,
  });
  if (refErr) return { status: 500, body: { error: 'refresh_failed', detail: refErr.message } };

  const days: unknown[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    // The run for day D happens at 06:00 Cairo on D+1 (04:00 UTC in winter).
    const nowIso = `${addDays(d, 1)}T04:00:00Z`;
    days.push(await processElder(ctx, elder, d, nowIso, false));
    const runDay = new Date(`${addDays(d, 1)}T00:00:00Z`).getUTCDay();
    if (runDay === 0) days.push(await weeklyForElder(ctx, elder, d));
  }
  await admin.from('trend_runs').insert({
    run_kind: 'replay', local_date: to, finished_at: new Date().toISOString(),
    result: { elder_id: elderId, from, to },
  });
  return { status: 200, body: { mode: 'replay', days } };
}
