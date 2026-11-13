// The founder's read-only checks for step30b / 30c / 30d, run in the order the
// founder applies the migrations (one at a time). Each must be all-ok after its
// step, and must notice when something is wrong.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { migration, preStep30a } from './harness';

const check = (step: string) => readFileSync(join(__dirname, '..', '..', 'scripts', 'rafiq', `check-step${step}.sql`), 'utf8');
async function failing(db: PGlite, step: string) {
  const r = await db.query<{ check_name: string; ok: boolean }>(check(step));
  expect(r.rows.length).toBeGreaterThan(2);
  return r.rows.filter((x) => !x.ok).map((x) => x.check_name);
}

describe('applying step30b, 30c, 30d one at a time, checking after each', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await preStep30a();
    await db.exec(migration('20261022090000_step30a_retire_llm_rafiq.sql'));   // already applied live
  }, 60_000);

  it('30b → check-step30b all ok', async () => {
    await db.exec(migration('20261022090100_step30b_rafiq_enums.sql'));
    expect(await failing(db, '30b')).toEqual([]);
  });
  it('30c alone → check-step30c fails only check 6, as it did on salem-prod (Supabase default grants)', async () => {
    await db.exec(migration('20261022090200_step30c_rafiq_tables.sql'));
    expect(await failing(db, '30c')).toEqual([
      'signed-in users can only read (never write) Rafiq tables, and never rafiq_runs']);
  });
  it('… and before step30e, authenticated really has REFERENCES and TRIGGER (the live finding)', async () => {
    const r = await db.query<{ p: string }>(`select distinct privilege_type as p from information_schema.role_table_grants
      where table_schema = 'public' and table_name like 'rafiq\\_%' and grantee = 'authenticated' order by 1`);
    expect(r.rows.map((x) => x.p)).toEqual(['REFERENCES', 'SELECT', 'TRIGGER']);
  });
  it('30e → check-step30e all ok, and check-step30c is now 12/12', async () => {
    await db.exec(migration('20261022090400_step30e_rafiq_privileges.sql'));
    expect(await failing(db, '30e')).toEqual([]);
    expect(await failing(db, '30c')).toEqual([]);
  });
  it('30e can be applied twice', async () => {
    await db.exec(migration('20261022090400_step30e_rafiq_privileges.sql'));
    expect(await failing(db, '30e')).toEqual([]);
  });
  it('30d → check-step30d all ok (nothing scheduled, Trend Watch still is)', async () => {
    await db.exec(migration('20261022090300_step30d_rafiq_functions.sql'));
    expect(await failing(db, '30d')).toEqual([]);
  });

  it('check-step30c notices a 24 h cooldown', async () => {
    await db.exec(`update public.rafiq_config set value = 24 where key = 'notify_cooldown_hours'`);
    expect(await failing(db, '30c')).toEqual([
      'notify_cooldown_hours = 72 (a reason that stays the same is not pushed again for 72 h)']);
    await db.exec(`update public.rafiq_config set value = 72 where key = 'notify_cooldown_hours'`);
  });
  it('check-step30c notices a write grant to app users', async () => {
    await db.exec(`grant insert on public.rafiq_alerts to authenticated`);
    expect(await failing(db, '30c')).toEqual([
      'signed-in users can only read (never write) Rafiq tables, and never rafiq_runs']);
    await db.exec(`revoke insert on public.rafiq_alerts from authenticated`);
  });
  it('check-step30e notices REFERENCES / TRIGGER, anon access, or a missing SELECT', async () => {
    await db.exec(`grant references on public.rafiq_scores to authenticated; grant select on public.rafiq_runs to anon;
                   revoke select on public.rafiq_config from authenticated`);
    expect(await failing(db, '30e')).toEqual([
      'not-signed-in users (anon): no privilege at all on Rafiq tables',
      'signed-in users: no REFERENCES, TRIGGER or TRUNCATE on any Rafiq table',
      'signed-in users: SELECT on config, baselines, scores and alerts — and only that']);
    await db.exec(migration('20261022090400_step30e_rafiq_privileges.sql'));
    expect(await failing(db, '30e')).toEqual([]);
  });
  it('check-step30d notices rafiq_tick already scheduled, or rafiq_raise callable by the app', async () => {
    await db.exec(`insert into cron.job (jobname, command) values ('x', 'select public.rafiq_tick()')`);
    await db.exec(`grant execute on function public.rafiq_tick(timestamptz) to authenticated`);
    expect(await failing(db, '30d')).toEqual([
      'the app can NOT call the server-only ones (raise, resolve, tick, elders, retention, cfg)',
      'nothing is scheduled yet (no cron job calls rafiq_tick)']);
  });
  it('check-step30b is all ok on a database where 30b is applied twice (safe to re-run)', async () => {
    const fresh = await preStep30a();
    await fresh.exec(migration('20261022090100_step30b_rafiq_enums.sql'));
    await fresh.exec(migration('20261022090100_step30b_rafiq_enums.sql'));
    expect(await failing(fresh, '30b')).toEqual([]);
  }, 60_000);
});
