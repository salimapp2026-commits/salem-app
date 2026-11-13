// step30b–d — Rafiq's tables, row-level security and rate limit, on the real
// migration files (PGlite). The scorer itself comes in step 2; here we check
// that whatever it writes is only readable by the right people and that the
// push rules hold.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, clearEdgeCalls, edgeCalls, withStep30 } from './harness';

const E = '7e57e1de-0000-4000-d000-000000000001'; // elder
const C = '7e57e1de-0000-4000-d000-000000000002'; // primary caretaker, read-health
const D = '7e57e1de-0000-4000-d000-000000000003'; // doctor, read-health
const F = '7e57e1de-0000-4000-d000-000000000004'; // family WITHOUT read-health
const O = '7e57e1de-0000-4000-d000-000000000005'; // outsider
const E2 = '7e57e1de-0000-4000-d000-000000000006'; // another elder (cap tests)

let db: PGlite;
const T0 = '2026-10-22T05:00:00Z'; // 07:00 Cairo

type Raise = {
  rafiq_alert_id: string; health_alert_id: string | null; new: boolean; escalated: boolean;
  notified: boolean; in_app_only: boolean; why: string;
};

async function raise(level: string, code: string, at: string, elder = E, extra: Partial<{ en: string; ar: string }> = {}) {
  await clearEdgeCalls(db);
  const r = await db.query<{ r: Raise }>(
    `select public.rafiq_raise($1, $2::public.rafiq_level, $3, array['resting_hr'], '{"delta":12,"days":4}'::jsonb,
       $4, $5, 'Rafiq: Mona', 'رفيق: منى', '2026-10-21'::date, null, 4, $6::timestamptz) as r`,
    [elder, level, code,
      extra.en ?? "Resting heart rate has been 12 bpm above Mona's usual for 4 nights. This is unusual compared to her normal, not a diagnosis. Contact the doctor if you are worried.",
      extra.ar ?? 'معدل النبض أثناء الراحة أعلى من المعتاد بـ 12 نبضة منذ 4 ليالٍ.',
      at],
  );
  return { ...r.rows[0].r, calls: await edgeCalls(db) };
}

const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

beforeAll(async () => {
  db = await withStep30();
  await db.exec(`
    insert into auth.users (id) values ('${E}'), ('${C}'), ('${D}'), ('${F}'), ('${O}'), ('${E2}');
    insert into public.profiles (id, display_name, role) values
      ('${E}', 'Mona Hassan', 'elder'), ('${C}', 'Sara', 'caretaker'), ('${D}', 'Dr Adel', 'doctor'),
      ('${F}', 'Omar', 'family'), ('${O}', 'Stranger', 'family'), ('${E2}', 'Hoda', 'elder');
    insert into public.care_circles (id, elder_id) values ('c1c1c1c1-0000-4000-8000-000000000001', '${E}');
    insert into public.care_circle_members (circle_id, user_id, member_role, can_read_health, can_read_location) values
      ('c1c1c1c1-0000-4000-8000-000000000001', '${C}', 'primary_caretaker', true, true),
      ('c1c1c1c1-0000-4000-8000-000000000001', '${D}', 'doctor', true, false),
      ('c1c1c1c1-0000-4000-8000-000000000001', '${F}', 'family', false, true);
    insert into public.vitals (elder_id, kind, value_numeric, captured_at) values ('${E}', 'heart_rate', 70, now());
    insert into public.rafiq_baselines (elder_id, metric, median, robust_sd) values ('${E}', 'hr_night', 62, 2);
    insert into public.rafiq_scores (elder_id, scope, scored_for, window_start, window_end, level)
      values ('${E}', 'day', '2026-10-21', '2026-10-20T22:00:00Z', '2026-10-22T05:00:00Z', 'watch');
  `);
}, 60_000);

describe('step30b–d apply cleanly', () => {
  it('enum and alert kind exist', async () => {
    const r = await db.query<{ v: string }>(`select unnest(enum_range(null::public.rafiq_level))::text as v`);
    expect(r.rows.map((x) => x.v)).toEqual(['normal', 'watch', 'alert', 'urgent']);
    const k = await db.query(`select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                               where t.typname = 'alert_kind' and e.enumlabel = 'rafiq'`);
    expect(k.rows).toHaveLength(1);
  });

  it('daily only for the pilot, hourly switchable in rafiq_config', async () => {
    const r = await db.query<{ key: string; value: string }>(
      `select key, value::text from public.rafiq_config
        where key in ('scoring_daily_enabled', 'scoring_hourly_enabled', 'daily_run_hour_cairo') order by key`);
    expect(r.rows).toEqual([
      { key: 'daily_run_hour_cairo', value: '7' },
      { key: 'scoring_daily_enabled', value: '1' },
      { key: 'scoring_hourly_enabled', value: '0' },
    ]);
  });

  it('no Rafiq table has anything that could hold a location', async () => {
    const r = await db.query<{ table_name: string; column_name: string }>(`
      select table_name, column_name from information_schema.columns
       where table_schema = 'public' and table_name like 'rafiq_%'
         and column_name ~* '(^|_)(lat|lon|lng|latitude|longitude|location|geog|geom|address|place|coords?)($|_)'`);
    expect(r.rows).toEqual([]);
  });
});

describe('who can read Rafiq (row-level security)', () => {
  const tables = ['rafiq_baselines', 'rafiq_scores', 'rafiq_alerts'] as const;

  beforeAll(async () => {
    await raise('watch', 'rls_probe', T0);
  });

  const cases: [string, string, boolean][] = [
    ['the elder', E, true],
    ['a caregiver with read-health', C, true],
    ['a linked doctor with read-health', D, true],
    ['family without read-health', F, false],
    ['an outsider', O, false],
  ];
  for (const [who, id, sees] of cases) {
    it(`${who}: ${sees ? 'sees' : 'sees nothing'}`, async () => {
      await asUser(db, id, async () => {
        for (const t of tables) {
          const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${t} where elder_id = $1`, [E]);
          expect(r.rows[0].n > 0, `${who} on ${t}`).toBe(sees);
        }
      });
    });
  }

  it('nobody in the app can write Rafiq tables, not even the elder', async () => {
    await asUser(db, E, async () => {
      for (const t of tables) {
        await expect(db.query(`delete from public.${t}`)).rejects.toThrow(/permission denied/);
      }
      await expect(db.query(`update public.rafiq_config set value = 0`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select * from public.rafiq_runs`)).rejects.toThrow(/permission denied/);
    });
  });

  it('the app cannot call the scorer-only functions', async () => {
    await asUser(db, C, async () => {
      await expect(db.query(
        `select public.rafiq_raise('${E}', 'urgent', 'x', '{}', '{}', 'a', 'b', 't', 't', current_date)`,
      )).rejects.toThrow(/permission denied/);
      await expect(db.query(`select public.rafiq_tick()`)).rejects.toThrow(/permission denied/);
    });
  });
});

describe('rafiq_raise: watch is in-app only, alert and urgent push, with a rate limit', () => {
  it('a new watch: in-app only, to caregivers with read-health and doctors, no alert row', async () => {
    const r = await raise('watch', 'resting_hr_up', T0, E2);
    expect(r).toMatchObject({ new: true, notified: true, in_app_only: true, why: 'new', health_alert_id: null });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].fn).toBe('notify-fanout');
    expect(r.calls[0].body).toMatchObject({ in_app_only: true, recipients: 'trend', severity: 'warning', source_kind: 'rafiq' });
    expect(r.calls[0].body.texts.ar.body).toMatch(/\S/);
    expect(JSON.stringify(r.calls[0].body)).not.toMatch(/location/);
  });

  it('the same watch again the same day: not repeated (cooldown)', async () => {
    const r = await raise('watch', 'resting_hr_up', plus(T0, 60), E2);
    expect(r).toMatchObject({ new: false, notified: false, why: 'cooldown' });
    expect(r.calls).toEqual([]);
  });

  it('escalated to alert: pushed at once, with a health_alerts row that carries no numbers', async () => {
    const r = await raise('alert', 'resting_hr_up', plus(T0, 120), E2);
    expect(r).toMatchObject({ escalated: true, notified: true, in_app_only: false, why: 'escalated' });
    expect(r.calls).toHaveLength(1); // only notify-fanout: the fanout trigger skips no_fanout rows
    expect(r.calls[0].body).toMatchObject({ severity: 'warning', in_app_only: false, recipients: 'trend' });
    const h = await db.query<{ kind: string; severity: string; payload: Record<string, unknown> }>(
      `select kind::text, severity::text, payload from public.health_alerts where id = $1`, [r.health_alert_id]);
    expect(h.rows[0]).toMatchObject({ kind: 'rafiq', severity: 'warning' });
    expect(h.rows[0].payload).toMatchObject({ no_fanout: true, source: 'rafiq', level: 'alert', reason_code: 'resting_hr_up' });
    expect(JSON.stringify(h.rows[0].payload)).not.toMatch(/\d{2} ?bpm|delta|location/);
  });

  it('a second new reason the same day: pushed (2 per day allowed)', async () => {
    const r = await raise('alert', 'spo2_night_down', plus(T0, 180), E2);
    expect(r).toMatchObject({ notified: true, why: 'new' });
  });

  it('a third new reason the same day: kept, not pushed (daily limit)', async () => {
    const r = await raise('alert', 'activity_down', plus(T0, 240), E2);
    expect(r).toMatchObject({ new: true, notified: false, why: 'daily_limit' });
    expect(r.calls).toEqual([]);
    const a = await db.query(`select 1 from public.rafiq_alerts where id = $1 and status = 'open'`, [r.rafiq_alert_id]);
    expect(a.rows).toHaveLength(1); // still recorded for the Rafiq screen
  });

  it('urgent bypasses the daily limit, as critical', async () => {
    const r = await raise('urgent', 'inactive_awake', plus(T0, 300), E2);
    expect(r).toMatchObject({ notified: true, why: 'urgent' });
    expect(r.calls[0].body).toMatchObject({ severity: 'critical', in_app_only: false });
    const h = await db.query<{ severity: string }>(`select severity::text from public.health_alerts where id = $1`, [r.health_alert_id]);
    expect(h.rows[0].severity).toBe('critical');
  });

  it('the same urgent retried within 30 minutes is not pushed twice', async () => {
    const r = await raise('urgent', 'inactive_awake', plus(T0, 310), E2);
    expect(r).toMatchObject({ notified: false, why: 'urgent_already_sent' });
  });

  it('…but an urgent that is still there later is pushed again (no cooldown for urgent)', async () => {
    const r = await raise('urgent', 'inactive_awake', plus(T0, 345), E2);
    expect(r).toMatchObject({ notified: true, why: 'urgent' });
  });

  it('a still-open alert is not repeated within 72 h of its last push (it escalated at +2 h)', async () => {
    const r = await raise('alert', 'resting_hr_up', plus(T0, 50 * 60), E2);
    expect(r).toMatchObject({ notified: false, why: 'cooldown' });
  });

  it('…and may remind once more after 72 h', async () => {
    const r = await raise('alert', 'resting_hr_up', plus(T0, 75 * 60), E2);
    expect(r).toMatchObject({ notified: true, why: 'reminder' });
  });

  it('a failed push never loses the alert', async () => {
    await db.exec(`insert into public.test_flags values ('post_edge_fails', true)`);
    try {
      const r = await raise('urgent', 'spo2_night_low', plus(T0, 76 * 60), E2);
      expect(r.notified).toBe(true);
      expect(r.why).toBe('urgent+push_failed');
      const a = await db.query(`select 1 from public.rafiq_alerts where id = $1`, [r.rafiq_alert_id]);
      expect(a.rows).toHaveLength(1);
    } finally {
      await db.exec(`delete from public.test_flags where key = 'post_edge_fails'`);
    }
  });

  it('refuses "normal" and a missing language', async () => {
    await expect(raise('normal', 'x', T0)).rejects.toThrow(/watch, alert or urgent/);
    await expect(raise('watch', 'x', T0, E, { ar: ' ' })).rejects.toThrow(/English and Arabic/);
  });
});

describe('acknowledge_rafiq_alert', () => {
  let id: string;
  beforeAll(async () => {
    id = (await raise('alert', 'ack_probe', T0)).rafiq_alert_id;
  });

  it('family without read-health cannot', async () => {
    await asUser(db, F, async () => {
      await expect(db.query(`select public.acknowledge_rafiq_alert($1)`, [id])).rejects.toThrow(/forbidden/);
    });
  });

  it('a caregiver with read-health can', async () => {
    const r = await asUser(db, C, async () =>
      (await db.query<{ status: string; acknowledged_by: string }>(
        `select (a).status, (a).acknowledged_by from (select public.acknowledge_rafiq_alert($1) as a) s`, [id])).rows[0]);
    expect(r).toEqual({ status: 'acknowledged', acknowledged_by: C });
  });

  it('getting worse reopens it', async () => {
    await raise('urgent', 'ack_probe', plus(T0, 60));
    const r = await db.query<{ status: string }>(`select status from public.rafiq_alerts where id = $1`, [id]);
    expect(r.rows[0].status).toBe('open');
  });
});

describe('rafiq_tick: daily at 07:00 Cairo, hourly only when switched on', () => {
  it('07:10 Cairo: the daily pass starts, for yesterday plus the night', async () => {
    await clearEdgeCalls(db);
    const r = await db.query<{ n: number }>(`select public.rafiq_tick('2026-10-23T04:10:00Z') as n`); // 07:10 EEST
    expect(r.rows[0].n).toBe(1);
    const calls = await edgeCalls(db);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ fn: 'rafiq-score', body: { mode: 'daily', scored_for: '2026-10-22', run_date: '2026-10-23' } });
  });

  it('a second tick the same hour does nothing', async () => {
    await clearEdgeCalls(db);
    const r = await db.query<{ n: number }>(`select public.rafiq_tick('2026-10-23T04:40:00Z') as n`);
    expect(r.rows[0].n).toBe(0);
    expect(await edgeCalls(db)).toEqual([]);
  });

  it('other hours do nothing while hourly scoring is off', async () => {
    await clearEdgeCalls(db);
    const r = await db.query<{ n: number }>(`select public.rafiq_tick('2026-10-23T09:00:00Z') as n`);
    expect(r.rows[0].n).toBe(0);
  });

  it('switching hourly on in rafiq_config starts "today so far" passes', async () => {
    await db.exec(`update public.rafiq_config set value = 1 where key = 'scoring_hourly_enabled'`);
    try {
      await clearEdgeCalls(db);
      await db.query(`select public.rafiq_tick('2026-10-23T09:05:00Z')`); // 12:05 Cairo
      const calls = await edgeCalls(db);
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toMatchObject({ mode: 'intraday', scored_for: '2026-10-23', hour: 12 });
    } finally {
      await db.exec(`update public.rafiq_config set value = 0 where key = 'scoring_hourly_enabled'`);
    }
  });

  it('daily switched off: no daily pass', async () => {
    await db.exec(`update public.rafiq_config set value = 0 where key = 'scoring_daily_enabled'`);
    try {
      await clearEdgeCalls(db);
      await db.query(`select public.rafiq_tick('2026-10-24T04:10:00Z')`);
      expect(await edgeCalls(db)).toEqual([]);
    } finally {
      await db.exec(`update public.rafiq_config set value = 1 where key = 'scoring_daily_enabled'`);
    }
  });
});

describe('housekeeping', () => {
  it('rafiq_elders_due lists elders with recent readings only', async () => {
    const r = await db.query<{ elder_id: string }>(`select elder_id from public.rafiq_elders_due(40)`);
    expect(r.rows.map((x) => x.elder_id)).toEqual([E]);
  });

  it('rafiq_retention deletes old hourly scores and keeps daily ones', async () => {
    await db.exec(`
      insert into public.rafiq_scores (elder_id, scope, scored_for, window_start, window_end, level, created_at) values
        ('${E}', 'intraday', '2026-01-01', '2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z', 'normal', now() - interval '120 days'),
        ('${E}', 'day',      '2026-01-01', '2026-01-01T00:00:00Z', '2026-01-02T05:00:00Z', 'normal', now() - interval '120 days');`);
    const r = await db.query<{ n: number }>(`select public.rafiq_retention() as n`);
    expect(r.rows[0].n).toBe(1);
    const left = await db.query<{ scope: string }>(
      `select scope from public.rafiq_scores where scored_for = '2026-01-01'`);
    expect(left.rows).toEqual([{ scope: 'day' }]);
  });
});
