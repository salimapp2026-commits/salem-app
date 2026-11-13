// trend-watch (verify_jwt: false — service-role only, checked below).
//
// Called by public.trend_watch_tick() at 06:00 Cairo every day:
//   1. refresh each elder's daily summaries (last 3 days, so late uploads count)
//   2. recompute baselines (days D-34..D-7, median + MAD) and learning state
//   3. run the rules from _shared/trendRules.ts with thresholds from trend_config
//   4. open / update / resolve trend_findings; raise a health_alerts row of kind
//      'trend' (payload.no_fanout, so analyze-vitals never re-scores it); notify
//      through notify-fanout with get_trend_recipients routing
//   5. explain it with the fixed English + Arabic templates (_shared/trendText.ts).
//      Since step30 (Rafiq ML) there is no outside AI anywhere in Trend Watch.
//   6. on Sundays (weekly=true) write the week-vs-week / month-vs-month summary
//
// Modes:
//   { mode: 'daily', weekly?: boolean }                      — the cron path
//   { mode: 'replay', elder_id, from, to, notify?: boolean } — testing: walks
//      one elder day by day with a simulated clock (06:00 Cairo each morning).
//
// Never produces 'critical' (clampSeverity + a DB check constraint), and never
// touches the real-time thresholds, SOS, or get_alert_recipients.
//
// Since step 2 of Rafiq ML the logic lives in _shared/trendWatchRun.ts and the
// daily pass is started by rafiq-score (07:00 Cairo). This function still
// serves the 'replay' testing path and, until the schedule migration moves the
// cron, the old 06:00 daily call — same code, same results.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { loadConfig, runTrendWatchDaily, runTrendWatchReplay } from '../_shared/trendWatchRun.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-salem-system-call',
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
function bearer(h: string | null): string | null {
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : h.trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (bearer(req.headers.get('Authorization')) !== SERVICE_ROLE && req.headers.get('apikey') !== SERVICE_ROLE) {
    return json({ error: 'forbidden' }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const c = await loadConfig(admin);

    if (body.mode === 'replay') {
      const elderId: string | undefined = body.elder_id;
      const from: string | undefined = body.from;
      const to: string | undefined = body.to;
      if (!elderId || !from || !to) return json({ error: 'replay_needs_elder_id_from_to' }, 400);
      const r = await runTrendWatchReplay(admin, c, { elderId, from, to, notify: body.notify !== false });
      return json(r.body, r.status);
    }

    // Daily (cron) path. Return at once and keep working in the background so
    // pg_net's 8-second timeout never cuts the run short.
    const weekly = body.weekly === true;
    const runDate = body.run_date ?? new Date().toISOString().slice(0, 10);
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    EdgeRuntime.waitUntil(runTrendWatchDaily(admin, c, { weekly, runDate }));
    return json({ accepted: true, weekly }, 202);
  } catch (e) {
    return json({ error: 'internal', detail: String((e as Error)?.message ?? e) }, 500);
  }
});
