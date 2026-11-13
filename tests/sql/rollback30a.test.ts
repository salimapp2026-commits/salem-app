// scripts/rafiq/rollback-step30a.sql must put the database back exactly as it
// was before step30a. "Before" = the live definitions (fixtures/live-pre-step30a.sql,
// read from the project's catalog), so this checks the rollback against live.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, clearEdgeCalls, edgeCalls, migration, preStep30a, withStep30 } from './harness';

const STEP30A = '20261022090000_step30a_retire_llm_rafiq.sql';
const SCRIPTS = join(__dirname, '..', '..', 'scripts', 'rafiq');
const ROLLBACK = readFileSync(join(SCRIPTS, 'rollback-step30a.sql'), 'utf8');
const CHECK = readFileSync(join(SCRIPTS, 'check-step30a.sql'), 'utf8');

const ELDER = '7e57e1de-0000-4000-e000-000000000001';
const OTHER = '7e57e1de-0000-4000-e000-000000000002';
const CONV = '33333333-0000-4000-8000-000000000001';
const ALERT = '44444444-0000-4000-8000-000000000001';

const FUNCTIONS = [
  'tg_health_alert_fanout', '_notify_emergency_first', 'recent_health_alerts', 'export_account_data',
  'record_ai_assessment', 'recent_ai_assessments', 'resolve_contacts', 'recent_health_context',
  '_alert_plain_texts', '_notify_alert_plain',
];

/** Everything step30a touches, as text — two equal snapshots mean an identical schema. */
async function snapshot(db: PGlite) {
  const fns = await db.query<{ name: string; def: string; acl: string[] | null; secdef: boolean }>(`
    select p.proname as name, pg_get_functiondef(p.oid) as def, p.prosecdef as secdef,
           (select array_agg(a::text order by a::text) from unnest(p.proacl) a) as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any($1)
     order by 1`, [FUNCTIONS]);
  const tables = await db.query(`
    select c.relname, c.relrowsecurity, obj_description(c.oid, 'pg_class') as comment
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and (c.relname like 'ai\\_%' or c.relname like 'retired\\_ai\\_%')
     order by 1`);
  const policies = await db.query(`
    select tablename, policyname, permissive, roles::text, cmd, qual, with_check
      from pg_policies where schemaname = 'public'
       and (tablename like 'ai\\_%' or tablename like 'retired\\_ai\\_%')
     order by 1, 2`);
  const grants = await db.query(`
    select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
      from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
       and (table_name like 'ai\\_%' or table_name like 'retired\\_ai\\_%')
     group by 1, 2 order by 1, 2`);
  const trigger = await db.query(`
    select tgname, tgenabled, pg_get_triggerdef(t.oid) as def from pg_trigger t
     where not tgisinternal and tgrelid = 'public.health_alerts'::regclass order by 1`);
  const fks = await db.query(`
    select conrelid::regclass::text as tbl, conname, confrelid::regclass::text as ref, confdeltype
      from pg_constraint where contype = 'f'
       and (conrelid::regclass::text ~ 'ai_' or confrelid::regclass::text ~ 'ai_')
     order by 1, 2`);
  return {
    functions: fns.rows, tables: tables.rows, policies: policies.rows, grants: grants.rows,
    trigger: trigger.rows, fks: fks.rows,
  };
}

async function seed(db: PGlite) {
  await db.exec(`
    insert into auth.users (id) values ('${ELDER}'), ('${OTHER}');
    insert into public.profiles (id, display_name) values ('${ELDER}', 'Mona Hassan'), ('${OTHER}', 'Omar');
    insert into public.ai_conversations (id, user_id, elder_id, title) values ('${CONV}', '${ELDER}', '${ELDER}', 'old chat');
    insert into public.ai_messages (conversation_id, role, content) values ('${CONV}', 'user', 'hello Rafiq');
    insert into public.health_alerts (id, elder_id, kind, severity, payload)
      values ('${ALERT}', '${ELDER}', 'hr_high', 'warning', '{"value": 118}');
    insert into public.ai_health_assessments (elder_id, triggered_by_alert_id, severity, explanation_ar, recommended_action)
      values ('${ELDER}', '${ALERT}', 'warning', 'old assessment', 'rest');`);
}

async function raise(db: PGlite, kind: string, severity: string) {
  await clearEdgeCalls(db);
  await db.query(`insert into public.health_alerts (elder_id, kind, severity) values ($1, $2::public.alert_kind, $3::public.alert_severity)`,
    [ELDER, kind, severity]);
  return (await edgeCalls(db)).map((c) => c.fn);
}

describe('apply step30a, then roll it back', () => {
  let db: PGlite;
  let before: Awaited<ReturnType<typeof snapshot>>;

  beforeAll(async () => {
    db = await preStep30a();
    await seed(db);
    before = await snapshot(db);
  }, 60_000);

  it('the "before" snapshot is the live shape (sanity)', () => {
    expect(before.tables.map((t: any) => t.relname)).toEqual(['ai_conversations', 'ai_health_assessments', 'ai_messages']);
    expect(before.policies).toHaveLength(4);
    expect(before.functions.map((f) => f.name)).not.toContain('_notify_alert_plain');
    expect(before.functions.find((f) => f.name === 'tg_health_alert_fanout')!.def).toContain("'analyze-vitals'");
  });

  it('step30a really changes all of it', async () => {
    await db.exec(migration(STEP30A));
    const after30a = await snapshot(db);
    expect(after30a).not.toEqual(before);
    expect(after30a.tables.map((t: any) => t.relname))
      .toEqual(['retired_ai_conversations', 'retired_ai_health_assessments', 'retired_ai_messages']);
    // While retired, the server keeps writing old-chat rows? No — but a row
    // written by hand (service role) in that window must survive the rollback.
    await db.exec(`insert into public.retired_ai_messages (conversation_id, role, content) values ('${CONV}', 'assistant', 'written while retired')`);
  });

  it('the rollback script runs cleanly (one transaction)', async () => {
    await db.exec(ROLLBACK);
  });

  it('afterwards every function, permission, table, policy, grant, foreign key and the trigger match the live "before" exactly', async () => {
    expect(await snapshot(db)).toEqual(before);
  });

  it('no row was lost, including the one written while retired', async () => {
    const r = await db.query<{ c: number; m: number; a: number }>(`
      select (select count(*)::int from public.ai_conversations) as c,
             (select count(*)::int from public.ai_messages) as m,
             (select count(*)::int from public.ai_health_assessments) as a`);
    expect(r.rows[0]).toEqual({ c: 1, m: 2, a: 1 });
  });

  it('behaves like before: non-emergency alerts go to analyze-vitals again, emergencies push first then analyze-vitals', async () => {
    expect(await raise(db, 'hr_high', 'warning')).toEqual(['analyze-vitals']);
    expect(await raise(db, 'sos', 'critical')).toEqual(['notify-fanout', 'analyze-vitals']);
  });

  it('the app reads the AI columns and the old chat again', async () => {
    await asUser(db, ELDER, async () => {
      const alerts = await db.query<{ id: string; ai_explanation_ar: string | null }>(
        `select id, ai_explanation_ar from public.recent_health_alerts(50, false) where id = $1`, [ALERT]);
      expect(alerts.rows[0].ai_explanation_ar).toBe('old assessment');
      const own = await db.query(`select 1 from public.ai_conversations`);
      expect(own.rows).toHaveLength(1);                      // their own chat, through the old policy
      const out = (await db.query<{ d: any }>(`select public.export_account_data() as d`)).rows[0].d;
      expect(out.ai_conversations[0].messages.map((m: any) => m.content)).toEqual(['hello Rafiq', 'written while retired']);
      const a = await db.query(`select * from public.recent_ai_assessments($1)`, [ELDER]);
      expect(a.rows).toHaveLength(1);
    });
    await asUser(db, OTHER, async () => {
      const r = await db.query(`select 1 from public.ai_conversations`);
      expect(r.rows).toEqual([]);                             // still nobody else's
    });
  });

  it('running the rollback a second time changes nothing', async () => {
    await db.exec(ROLLBACK);
    expect(await snapshot(db)).toEqual(before);
  });

  it('round trip: step30a again passes its live check, and rolling back again restores the same state', async () => {
    await db.exec(migration(STEP30A));
    const check = await db.query<{ ok: boolean; check_name: string }>(CHECK);
    expect(check.rows.filter((x) => !x.ok).map((x) => x.check_name)).toEqual([]);
    await db.exec(ROLLBACK);
    expect(await snapshot(db)).toEqual(before);
  });
});

describe('rolling back step30a when step30b–30d are already applied', () => {
  it('restores the old state and leaves the Rafiq tables alone', async () => {
    const ref = await preStep30a();
    const before = await snapshot(ref);

    const db = await withStep30();
    await db.exec(`insert into public.rafiq_config (key, value, description) values ('test_marker', 1, 'x')`);
    await db.exec(ROLLBACK);
    expect(await snapshot(db)).toEqual(before);
    const r = await db.query(`select 1 from public.rafiq_config where key = 'test_marker'`);
    expect(r.rows).toHaveLength(1);
    const fn = await db.query(`select 1 from pg_proc where proname = 'rafiq_raise'`);
    expect(fn.rows).toHaveLength(1);
  }, 60_000);
});
