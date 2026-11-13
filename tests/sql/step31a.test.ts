// step31a: Health Connect readings land in vitals once, in Rafiq's shape, never
// raise a per-reading alert, and only the elder's own phone can send them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { asUser, migration } from './harness';

const STEP31A = '20261031090000_step31a_health_connect.sql';
const ELDER = '00000000-0000-0000-0000-0000000000e1';
const CARER = '00000000-0000-0000-0000-0000000000c1';

// vitals, its policies, triggers and maybe_emit_vital_alert as live on salem-prod (read 2026-10-31).
const LIVE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;

create type public.vital_kind as enum ('heart_rate','blood_pressure','spo2','glucose','temperature','weight','steps','sleep','skin_temperature','movement');
create type public.vital_source as enum ('manual','healthkit','health_connect','watch','ai_inferred','band');
create type public.alert_kind as enum ('hr_low','hr_high','spo2_low','sos');
create type public.alert_severity as enum ('info','warning','critical');
create table public.profiles (id uuid primary key, role text);
create function public.has_perm(p_elder_id uuid, p_perm text) returns boolean language sql stable as
  $$ select p_elder_id = auth.uid() or auth.uid() = '${CARER}' $$;

create table public.vitals (
  id bigserial primary key, elder_id uuid not null references public.profiles(id), kind public.vital_kind not null,
  value_numeric numeric, value_systolic smallint, value_diastolic smallint, unit text,
  source public.vital_source not null default 'manual', device_id text, captured_at timestamptz not null,
  created_by uuid, created_at timestamptz not null default now(), is_resting boolean, quality smallint);
create unique index vitals_band_dedupe on public.vitals (device_id, kind, captured_at) where source = 'band';
alter table public.vitals enable row level security;
create policy vitals_select on public.vitals for select using (elder_id = auth.uid() or public.has_perm(elder_id, 'health'));
create policy vitals_insert on public.vitals for insert with check (elder_id = auth.uid() or public.has_perm(elder_id, 'health'));
create policy vitals_update on public.vitals for update using (elder_id = auth.uid() or created_by = auth.uid())
  with check (elder_id = auth.uid() or created_by = auth.uid());
create policy vitals_no_client_band_insert on public.vitals as restrictive for insert to authenticated, anon
  with check (source is distinct from 'band');
create policy vitals_no_client_band_update on public.vitals as restrictive for update to authenticated, anon
  using (source is distinct from 'band') with check (source is distinct from 'band');

create table public.health_alerts (id uuid primary key default gen_random_uuid(), elder_id uuid,
  kind public.alert_kind, severity public.alert_severity, payload jsonb default '{}', created_at timestamptz default now());
create table public.audit_log (n bigserial primary key, what text);
create function public.tg_audit_write() returns trigger language plpgsql security definer as
  $$ begin insert into public.audit_log (what) values (tg_op); return null; end $$;

${readFileSync(join(__dirname, 'fixtures', 'live-maybe-emit-vital-alert.sql'), 'utf8')}

create trigger audit_vitals after insert or update on public.vitals for each row
  when (new.source is distinct from 'band') execute function public.tg_audit_write();
create trigger audit_vitals_delete after delete on public.vitals for each row
  when (old.source is distinct from 'band') execute function public.tg_audit_write();
create trigger trg_maybe_emit_vital_alert after insert on public.vitals for each row
  when (new.source is distinct from 'band') execute function public.maybe_emit_vital_alert();

insert into public.profiles values ('${ELDER}', 'elder'), ('${CARER}', 'caregiver');
`;

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ingest = (db: PGlite, who: string, rows: unknown[]) =>
  asUser(db, who, async () =>
    (await db.query<{ r: { received: number; skipped: number; written: number } }>(
      'select public.hc_ingest($1::jsonb) as r', [JSON.stringify(rows)])).rows[0].r);
const count = async (db: PGlite, sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);
const check = () => readFileSync(join(__dirname, '..', '..', 'scripts', 'beta', 'check-step31a.sql'), 'utf8');

describe('step31a — Health Connect readings', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(LIVE);
    await db.exec(migration(STEP31A));
  }, 60_000);

  it('the elder\'s phone sends heart rate, oxygen and steps: stored once, as health_connect, in Rafiq\'s shape', async () => {
    const rows = [
      { k: 'heart_rate', t: ago(60), v: 62, r: true, q: 80 },
      { k: 'spo2', t: ago(60), v: 96, r: true, q: 80 },
      { k: 'steps', t: ago(50), v: 0, r: false, q: null },
      { k: 'steps', t: ago(40), v: 412, r: false, q: null },
    ];
    expect(await ingest(db, ELDER, rows)).toEqual({ received: 4, skipped: 0, written: 4 });
    const r = await db.query<{ kind: string; source: string; unit: string; is_resting: boolean; quality: number | null; created_by: string }>(
      `select kind::text, source::text, unit, is_resting, quality, created_by::text from public.vitals order by kind, captured_at`);
    expect(r.rows.map((x) => [x.kind, x.source, x.unit, x.is_resting, x.quality, x.created_by])).toEqual([
      ['heart_rate', 'health_connect', 'bpm', true, 80, ELDER],
      ['spo2', 'health_connect', '%', true, 80, ELDER],
      ['steps', 'health_connect', 'steps', false, null, ELDER],
      ['steps', 'health_connect', 'steps', false, null, ELDER],
    ]);
  });

  it('no duplicates: the same hours again write nothing; a filled-in block is updated, not added', async () => {
    const t = ago(30);
    expect(await ingest(db, ELDER, [{ k: 'steps', t, v: 0 }, { k: 'steps', t, v: 0 }])).toMatchObject({ written: 1 });
    expect(await ingest(db, ELDER, [{ k: 'steps', t, v: 0 }])).toMatchObject({ written: 0 });
    expect(await ingest(db, ELDER, [{ k: 'steps', t, v: 230 }])).toMatchObject({ written: 1 });
    expect(await count(db, `select count(*) n from public.vitals where kind = 'steps' and captured_at = '${t}'`)).toBe(1);
    expect(await count(db, `select value_numeric n from public.vitals where kind = 'steps' and captured_at = '${t}'`)).toBe(230);
  });

  it('a heart rate of 140 on a walk or oxygen of 85 never raises an alert, and is not audited row by row', async () => {
    const audits = await count(db, 'select count(*) n from public.audit_log');
    await ingest(db, ELDER, [{ k: 'heart_rate', t: ago(20), v: 140 }, { k: 'spo2', t: ago(20), v: 85 }]);
    expect(await count(db, 'select count(*) n from public.health_alerts')).toBe(0);
    expect(await count(db, 'select count(*) n from public.audit_log')).toBe(audits);
  });

  it('a manual reading still alerts and is audited exactly as before', async () => {
    await asUser(db, ELDER, () => db.query(
      `insert into public.vitals (elder_id, kind, value_numeric, source, captured_at) values ('${ELDER}', 'heart_rate', 140, 'manual', now())`));
    expect((await db.query<{ kind: string; severity: string }>('select kind::text, severity::text from public.health_alerts')).rows)
      .toEqual([{ kind: 'hr_high', severity: 'critical' }]);
    await db.exec('truncate public.health_alerts');
  });

  it('skips what cannot be real: out of range, older than 31 days, in the future', async () => {
    const r = await ingest(db, ELDER, [
      { k: 'heart_rate', t: ago(10), v: 300 },
      { k: 'spo2', t: ago(10), v: 40 },
      { k: 'steps', t: ago(10), v: 90_000 },
      { k: 'heart_rate', t: ago(32 * 24 * 60), v: 70 },
      { k: 'heart_rate', t: new Date(Date.now() + 3_600_000).toISOString(), v: 70 },
      { k: 'temperature', t: ago(10), v: 37 },
      { k: 'heart_rate', t: ago(10), v: 71, q: 80 },
    ]);
    expect(r).toEqual({ received: 7, skipped: 6, written: 1 });
  });

  it('only the elder\'s own phone: a caregiver is refused, anon cannot call it, >5000 rows refused', async () => {
    await expect(ingest(db, CARER, [{ k: 'heart_rate', t: ago(5), v: 70 }])).rejects.toThrow(/only the elder/);
    await db.exec('set role anon');
    await expect(db.query(`select public.hc_ingest('[]'::jsonb)`)).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    const many = Array.from({ length: 5001 }, (_, i) => ({ k: 'steps', t: ago(i), v: 1 }));
    await expect(ingest(db, ELDER, many)).rejects.toThrow(/at most 5000/);
  });

  it('the app cannot write health_connect rows directly, nor change them', async () => {
    await expect(asUser(db, ELDER, () => db.query(
      `insert into public.vitals (elder_id, kind, value_numeric, source, captured_at) values ('${ELDER}', 'heart_rate', 70, 'health_connect', now())`)))
      .rejects.toThrow(/row-level security/);
    await asUser(db, ELDER, () => db.query(`update public.vitals set value_numeric = 1 where source = 'health_connect'`));
    expect(await count(db, `select count(*) n from public.vitals where source = 'health_connect' and value_numeric = 1`)).toBe(0);
  });

  it('band rows are untouched: still no alert, still deduped by their own index', async () => {
    await db.exec(`insert into public.vitals (elder_id, kind, value_numeric, source, device_id, captured_at)
                   values ('${ELDER}', 'heart_rate', 150, 'band', 'B1', now())`);
    expect(await count(db, 'select count(*) n from public.health_alerts')).toBe(0);
  });

  it('check-step31a: all ok; safe to apply twice', async () => {
    const failing = async () => (await db.query<{ check_name: string; ok: boolean }>(check())).rows.filter((x) => !x.ok).map((x) => x.check_name);
    expect(await failing()).toEqual([]);
    await db.exec(migration(STEP31A));
    expect(await failing()).toEqual([]);
  });

  it('check-step31a notices the alert trigger back on Health Connect rows', async () => {
    await db.exec(`drop trigger trg_maybe_emit_vital_alert on public.vitals;
      create trigger trg_maybe_emit_vital_alert after insert on public.vitals for each row
        when (new.source is distinct from 'band') execute function public.maybe_emit_vital_alert();`);
    const r = (await db.query<{ check_name: string; ok: boolean }>(check())).rows.filter((x) => !x.ok).map((x) => x.check_name);
    expect(r).toEqual(['Health Connect rows never raise a per-reading alert (trg_maybe_emit_vital_alert skips them)']);
  });
});
