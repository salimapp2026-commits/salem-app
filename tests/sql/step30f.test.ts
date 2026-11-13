// step30f: Rafiq's morning pass is scheduled, Trend Watch's own job is gone, and
// the founder's read-only check (scripts/rafiq/check-step30f.sql) says so — and
// notices when it isn't true.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { STEP30F, clearEdgeCalls, edgeCalls, migration, preStep30a, withStep30 } from './harness';

const check = (step: string) => readFileSync(join(__dirname, '..', '..', 'scripts', 'rafiq', `check-step${step}.sql`), 'utf8');
async function failing(db: PGlite, step: string) {
  const r = await db.query<{ check_name: string; ok: boolean }>(check(step));
  expect(r.rows.length).toBeGreaterThan(2);
  return r.rows.filter((x) => !x.ok).map((x) => x.check_name);
}
const jobs = async (db: PGlite) =>
  (await db.query<{ jobname: string; schedule: string }>('select jobname, schedule from cron.job order by jobname')).rows;
/** What the cron job runs, at a given moment. */
const tick = (db: PGlite, at: string) => db.query(`select public.rafiq_tick('${at}'::timestamptz)`);

describe('step30f — the schedule', () => {
  let db: PGlite;
  let before: { jobname: string; schedule: string }[];
  beforeAll(async () => {
    db = await withStep30();
    await db.exec(migration('20261022090400_step30e_rafiq_privileges.sql'));
    before = await jobs(db);
    await db.exec(migration(STEP30F));
  }, 60_000);

  it('check-step30f: all ok', async () => {
    expect(await failing(db, '30f')).toEqual([]);
  });

  it('only two jobs changed: Trend Watch out, Rafiq in; the others keep their schedules', async () => {
    const expected = before.filter((j) => j.jobname !== 'salem_trend_watch_tick')
      .concat({ jobname: 'salem_rafiq_tick', schedule: '15 * * * *' })
      .sort((a, b) => a.jobname.localeCompare(b.jobname));
    expect(await jobs(db)).toEqual(expected);
  });

  it('check-step30d now reports exactly its two "not scheduled yet" rows', async () => {
    expect(await failing(db, '30d')).toEqual([
      'nothing is scheduled yet (no cron job calls rafiq_tick)',
      'Trend Watch is still scheduled as before (until the schedule migration)']);
  });

  it('one morning pass a day at 07:15 Cairo, winter and summer time, and nothing at other hours', async () => {
    await clearEdgeCalls(db);
    await tick(db, '2026-11-02 04:15:00+00');   // 06:15 Cairo (UTC+2): too early
    await tick(db, '2026-11-02 05:15:00+00');   // 07:15 Cairo
    await tick(db, '2026-11-02 05:15:30+00');   // a duplicate tick in the same hour
    await tick(db, '2026-11-02 06:15:00+00');   // 08:15
    await tick(db, '2027-06-01 04:15:00+00');   // 07:15 Cairo in summer time (UTC+3)
    const calls = await edgeCalls(db);
    expect(calls.map((c) => [c.fn, c.body.mode, c.body.run_date])).toEqual([
      ['rafiq-score', 'daily', '2026-11-02'],
      ['rafiq-score', 'daily', '2027-06-01'],
    ]);
    expect(calls.some((c) => c.fn === 'trend-watch')).toBe(false);   // Trend Watch runs inside rafiq-score
  });

  it('Sunday morning asks for the weekly Trend Watch summary', async () => {
    await clearEdgeCalls(db);
    await tick(db, '2026-11-08 05:15:00+00');   // Sunday 07:15 Cairo
    expect((await edgeCalls(db)).map((c) => c.body.weekly)).toEqual([true]);
  });

  it('safe to apply twice: still exactly one Rafiq job', async () => {
    await db.exec(migration(STEP30F));
    expect(await failing(db, '30f')).toEqual([]);
    expect((await jobs(db)).filter((j) => j.jobname === 'salem_rafiq_tick')).toHaveLength(1);
  });

  it('check-step30f notices a missing Rafiq job, Trend Watch back on its own, or the hourly pass on', async () => {
    await db.exec(`select cron.unschedule(jobid) from cron.job where jobname = 'salem_rafiq_tick';
                   select cron.schedule('salem_trend_watch_tick', '0 * * * *', 'select public.trend_watch_tick();');
                   update public.rafiq_config set value = 1 where key = 'scoring_hourly_enabled';`);
    expect(await failing(db, '30f')).toEqual([
      'Rafiq is scheduled: salem_rafiq_tick, active, every hour at :15, calls rafiq_tick()',
      'exactly one job calls rafiq_tick (no double morning pass)',
      'Trend Watch\'s own job is gone (salem_trend_watch_tick)',
      'no job starts Trend Watch on its own (trend_watch_tick or the trend-watch function)',
      'daily pass on, at 07 Cairo; hourly "today so far" pass off']);
    await db.exec(`update public.rafiq_config set value = 0 where key = 'scoring_hourly_enabled'`);
    await db.exec(migration(STEP30F));   // re-applying repairs it
    expect(await failing(db, '30f')).toEqual([]);
  });

  it('check-step30f notices another job gone or paused, a missing Vault secret, or a tick the app could call', async () => {
    await db.exec(`update cron.job set active = false where jobname = 'salem_band_tick';
                   delete from vault.secrets where name = 'salem_service_role_key';
                   grant execute on function public.rafiq_tick(timestamptz) to authenticated;`);
    expect(await failing(db, '30f')).toEqual([
      'the other 8 jobs are still there and active (band, reminders, retention, account deletion)',
      'the tick can reach rafiq-score: _post_edge exists and both Vault secrets are set (names only)',
      'the app can NOT start a pass: rafiq_tick is server-only']);
  });

  it('refuses to run before step30d (nothing would be scheduled that cannot run)', async () => {
    const fresh = await preStep30a();
    await expect(fresh.exec(migration(STEP30F))).rejects.toThrow(/apply step30d first/);
    expect((await jobs(fresh)).map((j) => j.jobname)).toContain('salem_trend_watch_tick');
  }, 60_000);
});
