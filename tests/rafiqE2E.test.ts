// End to end: a synthetic elder's raw band data → the TypeScript scorer (run.ts),
// one morning at a time, as rafiq-score does → the REAL Rafiq tables and the REAL
// rafiq_raise() rate limit (step30 migrations on PGlite) → the push requests
// that would go to notify-fanout. Nothing here talks to Supabase.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { rafiqDayStart, type Rows } from '../supabase/functions/_shared/rafiq/core.ts';
import type { RafiqModel } from '../supabase/functions/_shared/rafiq/model.ts';
import { type RafiqStore, type ScoreResult, scoreElderDay } from '../supabase/functions/_shared/rafiq/run.ts';
import { clearEdgeCalls, edgeCalls, withStep30 } from './sql/harness';

const ROOT = join(__dirname, '..');
const model = JSON.parse(readFileSync(join(ROOT, 'supabase/functions/_shared/rafiq/model.json'), 'utf8')) as RafiqModel;

function fixture(name: string) {
  const f = JSON.parse(gunzipSync(readFileSync(join(ROOT, `tests/fixtures/rafiq/parity-${name}.json.gz`))).toString('utf8'));
  const rows: Rows = { ...f.rows, resting: (f.rows.resting as number[]).map((x) => x === 1) };
  return { rows, events: f.events, expected: f.expected as { day: number; level: string }[], labels: f.labels };
}

/** PGlite-backed store: the real tables and functions; band data from the fixture. */
function pgStore(db: PGlite, fx: ReturnType<typeof fixture>, clock: { now: number }, trend: string[] = []): RafiqStore {
  const between = (t: number, a: number, b: number) => t >= a && t < b;
  return {
    async bandRows(_e, from, to) {
      const idx = fx.rows.t.map((t, i) => [t, i] as const).filter(([t]) => between(t, from, to)).map(([, i]) => i);
      return { t: idx.map((i) => fx.rows.t[i]), kind: idx.map((i) => fx.rows.kind[i]), value: idx.map((i) => fx.rows.value[i]),
        resting: idx.map((i) => fx.rows.resting[i]), quality: idx.map((i) => fx.rows.quality[i]) };
    },
    async bandEvents(_e, from, to) {
      const idx = fx.events.t.map((t: number, i: number) => [t, i] as const).filter(([t]: readonly [number, number]) => between(t, from, to));
      return { t: idx.map(([t]: readonly [number, number]) => t), kind: idx.map(([, i]: readonly [number, number]) => fx.events.kind[i]) };
    },
    async realtimeAlertKinds(e, fromIso, toIso) {
      const r = await db.query<{ kind: string }>(
        `select kind::text from public.health_alerts where elder_id = $1 and created_at >= $2 and created_at < $3`, [e, fromIso, toIso]);
      return r.rows.map((x) => x.kind);
    },
    async trendNotifiedMetrics() { return trend; },
    async openAlerts(e) {
      const r = await db.query<{ id: string; reason_code: string }>(
        `select id, reason_code from public.rafiq_alerts where elder_id = $1 and status in ('open', 'acknowledged')`, [e]);
      return r.rows;
    },
    async upsertBaselines(rows) {
      for (const b of rows) {
        await db.query(`insert into public.rafiq_baselines (elder_id, metric, median, robust_sd, relative, low, high, learning, computed_for, model_version)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          on conflict (elder_id, metric) do update set median = excluded.median, robust_sd = excluded.robust_sd,
            low = excluded.low, high = excluded.high, learning = excluded.learning, computed_for = excluded.computed_for`,
          [b.elder_id, b.metric, b.median, b.robust_sd, b.relative, b.low, b.high, b.learning, b.computed_for, b.model_version]);
      }
    },
    async upsertScore(s) {
      const r = await db.query<{ id: string }>(`insert into public.rafiq_scores
          (elder_id, scope, scored_for, window_start, window_end, level, learning, model_score, model_version, features, deviations, reasons)
        values ($1,$2,$3,$4,$5,$6::public.rafiq_level,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb)
        on conflict (elder_id, scope, window_end) do update set level = excluded.level, reasons = excluded.reasons
        returning id`,
        [s.elder_id, s.scope, s.scored_for, s.window_start, s.window_end, s.level, s.learning, s.model_score, s.model_version,
          JSON.stringify(s.features), JSON.stringify(s.deviations), JSON.stringify(s.reasons)]);
      return r.rows[0].id;
    },
    async raise(a) {
      const r = await db.query<{ r: Record<string, unknown> }>(
        `select public.rafiq_raise($1, $2::public.rafiq_level, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::date, $11, $12, $13::timestamptz) as r`,
        [a.p_elder, a.p_level, a.p_reason_code, a.p_metrics, JSON.stringify(a.p_params), a.p_reason_en, a.p_reason_ar,
          a.p_title_en, a.p_title_ar, a.p_scored_for, a.p_score_id, a.p_days, a.p_now]);
      return r.rows[0].r;
    },
    async resolve(id, nowIso) {
      await db.query(`select public.rafiq_resolve($1, $2::timestamptz)`, [id, nowIso]);
    },
  };
}

async function newElder(db: PGlite, id: string, name: string) {
  await db.query(`insert into auth.users (id) values ($1)`, [id]);
  await db.query(`insert into public.profiles (id, display_name, role) values ($1, $2, 'elder')`, [id, name]);
}

/** Every morning at 07:10 local: score yesterday, collect the push requests. */
async function liveThrough(db: PGlite, store: RafiqStore, clock: { now: number }, elder: string, name: string, days: number[]) {
  const pushes: { day: number; body: Record<string, any> }[] = [];
  const results = new Map<number, ScoreResult>();
  for (const d of days) {
    clock.now = rafiqDayStart(d + 1, 'Africa/Cairo', model.params) + 600;
    await clearEdgeCalls(db);
    results.set(d, await scoreElderDay(store, model, { elder_id: elder, display_name: name, timezone: 'Africa/Cairo' }, d,
      { scope: 'day', notify: true, nowUnix: clock.now, resolveDays: 3 }));
    for (const c of await edgeCalls(db)) pushes.push({ day: d, body: c.body });
  }
  return { pushes, results };
}

describe('a synthetic elder with a fever, through the whole pipeline', () => {
  const ELDER = '7e57e1de-0000-4000-f000-000000000001';
  let db: PGlite;
  let run: Awaited<ReturnType<typeof liveThrough>>;
  const fx = fixture('nov-2026');

  beforeAll(async () => {
    db = await withStep30();
    await newElder(db, ELDER, 'Mona Hassan');
    const clock = { now: 0 };
    const days = fx.expected.map((e) => e.day);
    run = await liveThrough(db, pgStore(db, fx, clock), clock, ELDER, 'Mona Hassan', days);
  }, 120_000);

  it('every day gets a stored verdict that matches what Python decided', async () => {
    for (const e of fx.expected) expect(run.results.get(e.day)?.level, `day ${e.day}`).toBe(e.level);
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.rafiq_scores where elder_id = $1`, [ELDER]);
    expect(n.rows[0].n).toBe(fx.expected.length);
  });

  it('says nothing while learning her normal', () => {
    const learning = fx.expected.filter((e: { day: number }) => run.results.get(e.day)?.learning).map((e) => e.day);
    expect(learning.length).toBeGreaterThan(10);
    expect(run.pushes.filter((p) => learning.includes(p.day))).toEqual([]);
  });

  it('the fever: pushed once, at alert, in English and Arabic, with the not-a-diagnosis note', () => {
    const feverPushes = run.pushes.filter((p) => p.body.in_app_only === false && p.body.texts.en.body.includes('skin temperature'));
    expect(feverPushes).toHaveLength(1);
    const b = feverPushes[0].body;
    expect(b).toMatchObject({ severity: 'warning', source_kind: 'rafiq', recipients: 'trend' });
    expect(b.texts.en.title).toBe("Rafiq: a change in Mona's readings");
    expect(b.texts.en.body).toMatch(/together with a higher resting heart rate/);
    expect(b.texts.en.body).toMatch(/not a diagnosis\. Contact the doctor if you are worried\.$/);
    expect(b.texts.ar.body).toMatch(/وليس تشخيصًا/);
    // the heart-rate reason that opened the next day is told by this push: not pushed on its own
    expect(run.pushes.filter((p) => /resting heart rate has been/.test(p.body.texts.en.body))).toEqual([]);
  });

  it('no push ever carries a location', () => {
    expect(JSON.stringify(run.pushes)).not.toMatch(/location|lat"|lon"|maps\.google/);
  });

  it('the alert appears in the alert list (health_alerts kind rafiq) and in rafiq_alerts, then settles', async () => {
    const h = await db.query<{ n: number }>(`select count(*)::int as n from public.health_alerts where elder_id = $1 and kind = 'rafiq'`, [ELDER]);
    expect(h.rows[0].n).toBeGreaterThanOrEqual(1);
    const a = await db.query<{ reason_code: string; status: string }>(
      `select reason_code, status from public.rafiq_alerts where elder_id = $1 order by opened_at`, [ELDER]);
    expect(a.rows.map((r) => r.reason_code)).toContain('temp_up');
    expect(a.rows.every((r) => r.status === 'resolved')).toBe(true);   // the data ends calm
  });

  it('her normal is stored for the charts', async () => {
    const b = await db.query<{ metric: string; low: number; high: number; learning: boolean }>(
      `select metric, low::float, high::float, learning from public.rafiq_baselines where elder_id = $1 order by metric`, [ELDER]);
    expect(b.rows).toHaveLength(9);
    const hr = b.rows.find((r) => r.metric === 'hr_night')!;
    expect(hr.learning).toBe(false);
    expect(hr.low).toBeLessThan(hr.high);
  });
});

describe('a fall and a week of inactivity, with the rules that avoid double pushes', () => {
  const fx = fixture('fall-inactivity');
  const days = fx.expected.map((e) => e.day);
  const fallDay = fx.expected.find((e) => e.level !== 'normal')!.day;

  it('the inactivity is pushed; the fall is pushed when the band did not already alert', async () => {
    const db = await withStep30();
    const E = '7e57e1de-0000-4000-f000-000000000002';
    await newElder(db, E, 'Hoda');
    const clock = { now: 0 };
    const run = await liveThrough(db, pgStore(db, fx, clock), clock, E, 'Hoda', days);
    const codes = run.pushes.filter((p) => !p.body.in_app_only).map((p) => p.body.texts.en.body);
    expect(codes.some((t) => /possible fall/.test(t))).toBe(true);
    expect(codes.some((t) => /less active than usual/.test(t))).toBe(true);
  }, 120_000);

  it('a fall the band already pushed in real time is shown in the app, not pushed again', async () => {
    const db = await withStep30();
    const E = '7e57e1de-0000-4000-f000-000000000003';
    await newElder(db, E, 'Hoda');
    const fallAt = new Date(fx.events.t[0] * 1000).toISOString();
    await db.query(`insert into public.health_alerts (elder_id, kind, severity, payload, created_at)
      values ($1, 'fall_detected', 'critical', '{"no_fanout": true, "source": "band"}', $2)`, [E, fallAt]);
    const clock = { now: 0 };
    const run = await liveThrough(db, pgStore(db, fx, clock), clock, E, 'Hoda', days);
    const fall = run.pushes.filter((p) => /possible fall/.test(p.body.texts.en.body));
    expect(fall).toHaveLength(1);
    expect(fall[0].body.in_app_only).toBe(true);
    expect(fallDay).toBeGreaterThan(0);
  }, 120_000);

  it('a change Trend Watch already pushed is shown in the app only', async () => {
    const db = await withStep30();
    const E = '7e57e1de-0000-4000-f000-000000000004';
    await newElder(db, E, 'Hoda');
    const clock = { now: 0 };
    const run = await liveThrough(db, pgStore(db, fx, clock, ['activity']), clock, E, 'Hoda', days);
    const act = run.pushes.filter((p) => /less active than usual/.test(p.body.texts.en.body));
    expect(act.length).toBeGreaterThan(0);
    expect(act.every((p) => p.body.in_app_only === true)).toBe(true);
  }, 120_000);
});
