// rafiq-score (verify_jwt: false — service-role only, checked below).
//
// Rafiq's scheduled pass (docs/RAFIQ_ML_PLAN.md). Started by public.rafiq_tick()
// once a day at 07:00 Cairo (and hourly only if rafiq_config says so):
//
//   { mode: 'daily', scored_for: 'YYYY-MM-DD', run_date, weekly? }   (scored_for = Cairo's
//       yesterday, for the log; each elder's own day comes from their timezone)
//       1. Trend Watch — its tested rules, unchanged (_shared/trendWatchRun.ts),
//          including the Sunday weekly summary
//       2. Rafiq — every elder with recent readings: personal baselines, the
//          trained Isolation Forest (model.json), the decision, the reasons in
//          English + Arabic, rafiq_raise() for each reason (the database applies
//          the rate limit and pushes)
//   { mode: 'intraday', scored_for, hour }    "today so far": urgent reasons only
//   { mode: 'replay', elder_id, from, to, notify? }   testing: one elder, day by
//       day (notify defaults to false)
//
// Our own code and our own model only: no outside AI service is called, and
// nothing here reads or writes a location.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { EVENT, KIND, type Events, type Rows, rafiqDayOf, rafiqDayStart } from '../_shared/rafiq/core.ts';
import { model } from '../_shared/rafiq/modelParts.ts';
import { modelSelfCheck } from '../_shared/rafiq/forest.ts';
import { type Elder, HISTORY_DAYS, type RafiqStore, dayIndex, preloadBand, scoreElderDay, withConfig } from '../_shared/rafiq/run.ts';
import { loadConfig as loadTrendConfig, runTrendWatchDaily } from '../_shared/trendWatchRun.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Is this exactly the model Python trained? (A digit lost in a deploy would
// otherwise score silently with a different model.) Checked once at start.
const modelCheck = modelSelfCheck(model);

// deno-lint-ignore no-explicit-any
type Admin = any;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-salem-system-call',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });
const bearer = (h: string | null) => (h ? (h.match(/^Bearer\s+(.+)$/i)?.[1] ?? h).trim() : null);

const KIND_CODE: Record<string, number> = KIND;
const PAGE = 1000;

async function readVitals(admin: Admin, elderId: string, source: 'band' | 'health_connect', fromUnix: number, toUnix: number): Promise<Rows> {
  const rows: Rows = { t: [], kind: [], value: [], resting: [], quality: [] };
  for (let page = 0; ; page++) {
    const { data, error } = await admin.from('vitals')
      .select('kind, value_numeric, captured_at, is_resting, quality')
      .eq('elder_id', elderId).eq('source', source)
      .in('kind', Object.keys(KIND_CODE))
      .gte('captured_at', new Date(fromUnix * 1000).toISOString())
      .lt('captured_at', new Date(toUnix * 1000).toISOString())
      .order('captured_at', { ascending: true }).order('id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`vitals: ${error.message}`);
    for (const r of (data ?? []) as { kind: string; value_numeric: number | null; captured_at: string; is_resting: boolean | null; quality: number | null }[]) {
      if (r.value_numeric === null) continue;
      rows.t.push(Math.floor(Date.parse(r.captured_at) / 1000));
      rows.kind.push(KIND_CODE[r.kind]);
      rows.value.push(Number(r.value_numeric));
      rows.resting.push(r.is_resting === true);
      rows.quality.push(r.quality === null ? 255 : r.quality);   // NULL = not applicable
    }
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Supabase-backed storage for run.ts. */
function supabaseStore(admin: Admin): RafiqStore {
  return {
    /** Salem Band rows; for an elder with none in the window, their Health Connect rows
     *  (step31a: already in the band's shape). Never both, so nothing is counted twice. */
    async bandRows(elderId, fromUnix, toUnix) {
      const band = await readVitals(admin, elderId, 'band', fromUnix, toUnix);
      return band.t.length ? band : await readVitals(admin, elderId, 'health_connect', fromUnix, toUnix);
    },
    async bandEvents(elderId, fromUnix, toUnix) {
      const { data, error } = await admin.from('band_events')
        .select('kind, occurred_at')
        .eq('elder_id', elderId).in('kind', ['fall', 'fall_cancelled'])
        .not('occurred_at', 'is', null)
        .gte('occurred_at', new Date(fromUnix * 1000).toISOString())
        .lt('occurred_at', new Date(toUnix * 1000).toISOString())
        .order('occurred_at', { ascending: true });
      if (error) throw new Error(`band_events: ${error.message}`);
      const ev: Events = { t: [], kind: [] };
      for (const e of (data ?? []) as { kind: 'fall' | 'fall_cancelled'; occurred_at: string }[]) {
        ev.t.push(Math.floor(Date.parse(e.occurred_at) / 1000));
        ev.kind.push(EVENT[e.kind]);
      }
      return ev;
    },
    async realtimeAlertKinds(elderId, fromIso, toIso) {
      const { data } = await admin.from('health_alerts').select('kind')
        .eq('elder_id', elderId).gte('created_at', fromIso).lt('created_at', toIso);
      return ((data ?? []) as { kind: string }[]).map((a) => a.kind);
    },
    async trendNotifiedMetrics(elderId, sinceIso) {
      const { data } = await admin.from('trend_findings').select('metric')
        .eq('elder_id', elderId).gte('last_notified_at', sinceIso);
      return ((data ?? []) as { metric: string }[]).map((f) => f.metric);
    },
    async openAlerts(elderId) {
      const { data } = await admin.from('rafiq_alerts').select('id, reason_code')
        .eq('elder_id', elderId).in('status', ['open', 'acknowledged']);
      return (data ?? []) as { id: string; reason_code: string }[];
    },
    async upsertBaselines(rows) {
      const { error } = await admin.from('rafiq_baselines').upsert(rows, { onConflict: 'elder_id,metric' });
      if (error) throw new Error(`rafiq_baselines: ${error.message}`);
    },
    async upsertScore(row) {
      const { data, error } = await admin.from('rafiq_scores')
        .upsert(row, { onConflict: 'elder_id,scope,window_end' }).select('id').single();
      if (error) throw new Error(`rafiq_scores: ${error.message}`);
      return data?.id ?? null;
    },
    async raise(args) {
      const { data, error } = await admin.rpc('rafiq_raise', args);
      if (error) return { error: error.message, code: args.p_reason_code };
      return data as Record<string, unknown>;
    },
    async resolve(id, nowIso) {
      await admin.rpc('rafiq_resolve', { p_rafiq_alert: id, p_now: nowIso });
    },
  };
}

async function config(admin: Admin): Promise<Record<string, number>> {
  const { data } = await admin.from('rafiq_config').select('key, value');
  return Object.fromEntries(((data ?? []) as { key: string; value: number }[]).map((r) => [r.key, Number(r.value)]));
}

async function eldersDue(admin: Admin): Promise<Elder[]> {
  const { data, error } = await admin.rpc('rafiq_elders_due', { p_lookback_days: 40 });
  if (error) throw new Error(`rafiq_elders_due: ${error.message}`);
  return (data ?? []) as Elder[];
}

/** Every elder with recent readings. Each elder's day comes from their OWN timezone: the
 *  daily pass scores their latest complete Rafiq day (it ends at 07:00 where they live —
 *  for an elder in London that is not yet the case at 07:00 Cairo), the intraday pass
 *  their current day so far. */
async function runAll(admin: Admin, scope: 'day' | 'intraday') {
  const store = supabaseStore(admin);
  const cfg = await config(admin);
  const configured = withConfig(model, cfg);
  const out: unknown[] = [];
  const nowUnix = Math.floor(Date.now() / 1000);
  for (const elder of await eldersDue(admin)) {
    try {
      const current = rafiqDayOf(nowUnix, elder.timezone, model.params);
      out.push(await scoreElderDay(store, configured, elder, scope === 'day' ? current - 1 : current, {
        scope, notify: true, nowUnix, resolveDays: cfg.resolve_days ?? 3,
      }));
    } catch (err) {
      out.push({ elder: elder.elder_id, error: String((err as Error)?.message ?? err) });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (bearer(req.headers.get('Authorization')) !== SERVICE_ROLE && req.headers.get('apikey') !== SERVICE_ROLE) {
    return json({ error: 'forbidden' }, 403);
  }
  const body = await req.json().catch(() => ({}));
  if (!modelCheck.ok) {
    return json({ error: 'model_check_failed', model_version: model.version, model_check: modelCheck }, 500);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    if (body.mode === 'replay') {
      const { elder_id, from, to } = body as { elder_id?: string; from?: string; to?: string };
      if (!elder_id || !from || !to) return json({ error: 'replay_needs_elder_id_from_to' }, 400);
      const { data: p } = await admin.from('profiles').select('id, display_name, timezone').eq('id', elder_id).single();
      if (!p) return json({ error: 'elder_not_found' }, 404);
      const elder: Elder = { elder_id: p.id, display_name: p.display_name ?? '', timezone: p.timezone || 'Africa/Cairo' };
      const cfg = await config(admin);
      const first = dayIndex(from), last = dayIndex(to);
      // Read the band data once for the whole replay (plus the history the first day needs).
      const store = await preloadBand(supabaseStore(admin), elder.elder_id,
        rafiqDayStart(first - HISTORY_DAYS + 1, elder.timezone, model.params),
        rafiqDayStart(last + 1, elder.timezone, model.params));
      const days: unknown[] = [];
      for (let d = first; d <= last; d++) {
        // As if run at 07:00 Cairo the next morning.
        const nowUnix = (d + 1) * 86400 + 5 * 3600;
        days.push(await scoreElderDay(store, withConfig(model, cfg), elder, d, {
          scope: 'day', notify: body.notify === true, nowUnix, resolveDays: cfg.resolve_days ?? 3,
        }));
      }
      return json({ mode: 'replay', model_version: model.version, model_check: modelCheck, days });
    }

    const scoredFor: string | undefined = body.scored_for;
    if (!scoredFor) return json({ error: 'scored_for_required' }, 400);

    if (body.mode === 'intraday') {
      // @ts-ignore EdgeRuntime is provided by the Supabase runtime
      EdgeRuntime.waitUntil(runAll(admin, 'intraday'));
      return json({ accepted: true, mode: 'intraday' }, 202);
    }

    // Daily: Trend Watch first (its rules, its pushes, unchanged), then Rafiq.
    // Return at once and keep working in the background (pg_net times out at 8 s).
    const runDate: string = body.run_date ?? new Date().toISOString().slice(0, 10);
    const work = (async () => {
      const result: Record<string, unknown> = { model_version: model.version };
      try {
        result.trend_watch = await runTrendWatchDaily(admin, await loadTrendConfig(admin), {
          weekly: body.weekly === true, runDate,
        });
      } catch (err) {
        result.trend_watch = { error: String((err as Error)?.message ?? err) };
      }
      result.rafiq = await runAll(admin, 'day');
      await admin.from('rafiq_runs').update({
        finished_at: new Date().toISOString(), model_version: model.version, result,
      }).eq('run_kind', 'daily').eq('local_date', runDate).eq('local_hour', 0);
    })();
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    EdgeRuntime.waitUntil(work);
    return json({ accepted: true, mode: 'daily', scored_for: scoredFor }, 202);
  } catch (e) {
    return json({ error: 'internal', detail: String((e as Error)?.message ?? e) }, 500);
  }
});
