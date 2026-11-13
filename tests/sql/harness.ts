// A throw-away Postgres (PGlite: real Postgres compiled to WebAssembly) with the
// slice of the production schema that a migration under test touches. Nothing
// here talks to Supabase.
//
// What is real: the migration files themselves, plus function bodies copied
// verbatim out of earlier migrations (extractFunction). What is stubbed:
// _post_edge (records each edge-function request in test_edge_calls instead of
// sending it), auth.uid() (reads a session setting), the Supabase roles, and
// _emergency_location (needs PostGIS, which PGlite doesn't ship).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(__dirname, '..', '..');
export const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

export function migration(file: string): string {
  return readFileSync(join(MIGRATIONS, file), 'utf8');
}

/** `create or replace function public.<name>(...) … $$;` copied out of a migration file. */
export function extractFunction(file: string, name: string): string {
  const sql = migration(file);
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  const bodyStart = sql.indexOf('$$', start);
  const bodyEnd = sql.indexOf('$$;', bodyStart + 2);
  return sql.slice(start, bodyEnd + 3);
}

export const ALERT_KINDS = [
  'sos', 'fall_detected', 'hr_high', 'hr_low', 'spo2_low', 'zone_exit', 'low_battery',
  'no_movement', 'med_missed', 'trend', 'band_off_wrist', 'band_no_data',
] as const;

// The production state before step30a, reduced to what step30a touches.
// Table shapes, policies and function signatures match the live project
// (read from its catalog on 2026-10-22).
const BASE = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

-- Supabase's default privileges: every table, function and sequence created in
-- public is granted to anon, authenticated and service_role unless a migration
-- revokes it. (Missing here once let a REFERENCES/TRIGGER grant slip through.)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;

create type public.alert_kind as enum (${ALERT_KINDS.map((k) => `'${k}'`).join(', ')});
create type public.alert_severity as enum ('info', 'warning', 'critical');

create table public.profiles (id uuid primary key, display_name text, timezone text, role text default 'elder',
  preferred_locale text, phone_e164 text, date_of_birth date, gender text);
create table public.care_circles (id uuid primary key default gen_random_uuid(), elder_id uuid unique);
create table public.care_circle_members (
  id uuid primary key default gen_random_uuid(), circle_id uuid, user_id uuid,
  member_role text, relationship text, status text not null default 'active',
  can_read_health boolean not null default false, can_read_location boolean not null default false,
  can_chat boolean not null default false, can_call boolean not null default false,
  can_manage_circle boolean not null default false);

-- has_perm exactly as live (read from the catalog 2026-10-22).
create function public.has_perm(p_elder_id uuid, p_perm text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_allowed boolean := false;
begin
  if p_elder_id = auth.uid() then return true; end if;
  select case p_perm
    when 'health'   then m.can_read_health
    when 'location' then m.can_read_location
    when 'chat'     then m.can_chat
    when 'call'     then m.can_call
    when 'manage'   then m.can_manage_circle
    else false
  end
  into v_allowed
  from public.care_circle_members m
  join public.care_circles c on c.id = m.circle_id
  where c.elder_id = p_elder_id
    and m.user_id = auth.uid()
    and m.status = 'active';
  return coalesce(v_allowed, false);
end $$;
grant execute on function public.has_perm(uuid, text) to anon, authenticated;
create table public.vitals (id bigserial primary key, elder_id uuid, kind text, value_numeric numeric,
  value_systolic numeric, value_diastolic numeric, unit text, captured_at timestamptz default now());
create table public.emergency_contacts (id uuid primary key default gen_random_uuid(), elder_id uuid,
  name text, relation text, phone_e164 text, priority smallint, created_at timestamptz default now());
create table public.reminders (id uuid primary key default gen_random_uuid(), elder_id uuid);
create table public.medications (id uuid primary key default gen_random_uuid(), elder_id uuid,
  name text, dose text, notes text, active boolean default true);
create table public.doctor_visits (id uuid primary key default gen_random_uuid(), elder_id uuid, visit_date date);
create table public.messages (id uuid primary key default gen_random_uuid(), sender_id uuid, created_at timestamptz default now());
create table public.notification_log (id uuid primary key default gen_random_uuid(), recipient_user_id uuid, sent_at timestamptz default now());

create table public.health_alerts (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid not null references public.profiles(id) on delete cascade,
  kind public.alert_kind not null,
  severity public.alert_severity not null,
  payload jsonb not null default '{}',
  acknowledged_by uuid, acknowledged_at timestamptz, resolved_at timestamptz,
  created_at timestamptz not null default now());

-- The old Rafiq tables with their live columns. Their policies, grants and the
-- functions step30a changes come from fixtures/live-pre-step30a.sql.
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  elder_id uuid, title text, created_at timestamptz not null default now());
create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text, content text, model text, audio_path text, tokens_prompt integer, tokens_output integer,
  created_at timestamptz not null default now());
create table public.ai_health_assessments (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid not null references public.profiles(id) on delete cascade,
  triggered_by_alert_id uuid, severity public.alert_severity, explanation_ar text,
  recommended_action text, context_summary jsonb, model_used text, tokens_used integer,
  created_at timestamptz not null default now());
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_health_assessments enable row level security;
grant select on public.health_alerts, public.profiles to authenticated;

-- pg_cron's job table and its two functions, as on Supabase, with the jobs live
-- on salem-prod (read 2026-10-30) — a schedule migration must leave the others alone.
create schema cron;
create table cron.job (jobid serial primary key, jobname text, schedule text, command text,
  active boolean not null default true);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) returning jobid $$;
create function cron.unschedule(job_id bigint) returns boolean language sql as
  $$ with d as (delete from cron.job where jobid = job_id returning 1) select exists (select 1 from d) $$;
insert into cron.job (jobname, schedule, command) values
  ('salem_trend_watch_tick', '0 * * * *', ' select public.trend_watch_tick(); '),
  ('salem_band_tick', '30 seconds', ' select public.band_tick(); '),
  ('salem_band_watchdog', '5 * * * *', ' select public.band_watchdog(); '),
  ('salem_band_retention', '30 0 * * *', ' select public.band_purge_raw(); '),
  ('salem_location_retention', '45 0 * * *', ' select public.location_purge(); '),
  ('salem_dispatch_due_reminders', '* * * * *', ' select public.dispatch_due_reminders(); '),
  ('salem_materialize_reminder_events', '*/15 * * * *', ' select public.materialize_reminder_events(); '),
  ('salem_expire_stale_reminder_events', '*/5 * * * *', ' select public.expire_stale_reminder_events(); '),
  ('finalize-account-deletions', '0 3 * * *', ' select public.finalize_account_deletions(); ');

-- Supabase Vault: only the secret names matter here (_post_edge is stubbed below).
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
insert into vault.secrets (name, secret) values ('salem_project_url', 'test'), ('salem_service_role_key', 'test');

-- Edge-function calls are recorded, never sent.
create table public.test_edge_calls (n bigserial primary key, fn text not null, body jsonb not null);
create table public.test_flags (key text primary key, on_ boolean not null);
create function public._post_edge(p_fn text, p_body jsonb) returns void language plpgsql as $$
begin
  if exists (select 1 from public.test_flags where key = 'post_edge_fails' and on_) then
    raise exception 'pg_net is down (test)';
  end if;
  insert into public.test_edge_calls (fn, body) values (p_fn, p_body);
end $$;

-- Needs PostGIS in production; the location path is covered by scripts/band/checks.sql.
create function public._emergency_location(p_alert uuid, p_elder uuid) returns jsonb language sql as $$ select null::jsonb $$;
`;

/** A database in the pre-step30a state: the live definitions (fixture), the trigger attached as in production. */
export async function preStep30a(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(extractFunction('20261013140000_step28a_emergency_first.sql', '_notify_emergency_first'));
  await db.exec(readFileSync(join(__dirname, 'fixtures', 'live-pre-step30a.sql'), 'utf8'));
  return db;
}

export async function edgeCalls(db: PGlite): Promise<{ fn: string; body: Record<string, any> }[]> {
  const r = await db.query<{ fn: string; body: Record<string, any> }>('select fn, body from public.test_edge_calls order by n');
  return r.rows;
}

export async function clearEdgeCalls(db: PGlite) {
  await db.exec('truncate public.test_edge_calls');
}

/** Run `fn` as an app user (role authenticated, auth.uid() = userId), then switch back. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set request.jwt.claim.sub = '${userId}'; set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`);
  }
}

export const STEP30 = [
  '20261022090000_step30a_retire_llm_rafiq.sql',
  '20261022090100_step30b_rafiq_enums.sql',
  '20261022090200_step30c_rafiq_tables.sql',
  '20261022090300_step30d_rafiq_functions.sql',
];
export const STEP30F = '20261030090000_step30f_rafiq_schedule.sql';

/** The pre-step30 database with every step30 migration applied, in order. */
export async function withStep30(): Promise<PGlite> {
  const db = await preStep30a();
  for (const f of STEP30) await db.exec(migration(f));
  return db;
}
