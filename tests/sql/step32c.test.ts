// step32c: the confirmed help numbers on the server equal the app's built-in ones;
// crisis alerts from Rafiq's chat are invisible to doctors (caregivers with health
// permission and the elder only), other alerts unchanged; medicine reminders land at
// the elder's own local time, and wrongly-timed future events are made again.
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { asUser, migration } from './harness';
import { HELP_NUMBERS } from '../../native/src/lib/rafiqChat/lines';

const STEP32A = '20261101090000_step32a_rafiq_chat.sql';
const STEP32C = '20261101090200_step32c_help_numbers_crisis_privacy_reminder_tz.sql';
const ELDER = '00000000-0000-0000-0000-0000000000e1';
const RIYADH_ELDER = '00000000-0000-0000-0000-0000000000e2';
const NOTZ_ELDER = '00000000-0000-0000-0000-0000000000e3';
const CARER = '00000000-0000-0000-0000-0000000000c1';
const DOCTOR = '00000000-0000-0000-0000-0000000000d1';

// The live shapes step32a and step32c touch (salem-prod, read 2026-11-01), including the
// old _reminder_next_local_time_run and materialize_reminder_events verbatim.
const LIVE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;

create type public.alert_kind as enum ('sos','fall_detected','rafiq');
create type public.alert_severity as enum ('info','warning','critical');
create type public.circle_member_role as enum ('primary_caretaker','family','doctor');
create type public.circle_member_status as enum ('pending','active','removed');
create table public.profiles (id uuid primary key, role text, display_name text, timezone text default 'UTC', preferred_locale text);
create table public.care_circles (id uuid primary key default gen_random_uuid(), elder_id uuid not null unique);
create table public.care_circle_members (circle_id uuid, user_id uuid, member_role public.circle_member_role,
  can_read_health boolean default true, status public.circle_member_status default 'active');
create function public.is_in_circle(p_elder uuid) returns boolean language sql stable security definer as
  $$ select exists (select 1 from public.care_circle_members m join public.care_circles c on c.id = m.circle_id
                    where c.elder_id = p_elder and m.user_id = auth.uid() and m.status = 'active') $$;
create table public.health_alerts (id uuid primary key default gen_random_uuid(), elder_id uuid not null,
  kind public.alert_kind not null, severity public.alert_severity not null, payload jsonb not null default '{}',
  acknowledged_at timestamptz, created_at timestamptz not null default now());
alter table public.health_alerts enable row level security;
create policy alerts_select on public.health_alerts for select using ((elder_id = auth.uid()) or public.is_in_circle(elder_id));
create policy alerts_update_ack on public.health_alerts for update using ((elder_id = auth.uid()) or public.is_in_circle(elder_id));
create table public.test_edge_calls (slug text, body jsonb);
create function public._post_edge(p_slug text, p_body jsonb) returns bigint language sql security definer as
  $$ insert into public.test_edge_calls values (p_slug, p_body); select 1::bigint $$;
create function public._emergency_location(p_alert uuid, p_elder uuid) returns jsonb language sql as $$ select null::jsonb $$;

create table public.reminders (id bigserial primary key, elder_id uuid, title text, local_time time, next_run_at timestamptz, active boolean default true);
create table public.reminder_events (id bigserial primary key, reminder_id bigint, elder_id uuid, scheduled_at timestamptz,
  status text default 'pending', responded_at timestamptz, notes text);

create or replace function public._reminder_next_local_time_run(p_elder_id uuid, p_local_time time without time zone, p_after timestamp with time zone)
 returns timestamp with time zone language plpgsql stable set search_path to 'public' as $function$
declare
  v_tz text := 'Asia/Riyadh';
  v_locale text;
  v_local_date date;
  v_candidate timestamptz;
begin
  select preferred_locale into v_locale from public.profiles where id = p_elder_id;
  if v_locale is not null and v_locale not like 'ar%' then
    v_tz := 'UTC';
  end if;
  v_local_date := (p_after at time zone v_tz)::date;
  v_candidate := ((v_local_date::text || ' ' || p_local_time::text)::timestamp at time zone v_tz);
  if v_candidate <= p_after then
    v_candidate := (((v_local_date + 1)::text || ' ' || p_local_time::text)::timestamp at time zone v_tz);
  end if;
  return v_candidate;
end;
$function$;

create or replace function public.materialize_reminder_events(p_horizon_hours integer default 36)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  r record;
  v_next timestamptz;
  v_inserted int := 0;
  v_horizon_until timestamptz := now() + (greatest(1, least(coalesce(p_horizon_hours, 36), 168)) || ' hours')::interval;
begin
  for r in
    select id, elder_id, local_time, next_run_at from public.reminders
     where active = true and (local_time is not null or next_run_at is not null)
  loop
    if r.next_run_at is not null and r.next_run_at <= v_horizon_until then
      v_next := r.next_run_at;
    elsif r.local_time is not null then
      v_next := public._reminder_next_local_time_run(r.elder_id, r.local_time, now());
      if v_next > v_horizon_until then continue; end if;
    else
      continue;
    end if;
    if not exists (select 1 from public.reminder_events where reminder_id = r.id and scheduled_at = v_next) then
      insert into public.reminder_events (reminder_id, elder_id, scheduled_at, status) values (r.id, r.elder_id, v_next, 'pending');
      v_inserted := v_inserted + 1;
    end if;
  end loop;
  return v_inserted;
end;
$function$;
`;

let db: PGlite;
const cairo = async (elder: string) => (await db.query<{ title: string; t: string }>(`
  select r.title, to_char(e.scheduled_at at time zone 'Africa/Cairo', 'HH24:MI') t
    from public.reminder_events e join public.reminders r on r.id = e.reminder_id
   where e.elder_id = '${elder}' and e.scheduled_at > now() order by r.title`)).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(LIVE);
  await db.exec(`
    insert into public.profiles (id, role, display_name, timezone, preferred_locale) values
      ('${ELDER}', 'elder', 'Mona', 'Africa/Cairo', 'en'),
      ('${RIYADH_ELDER}', 'elder', 'Hoda', 'Asia/Riyadh', 'ar'),
      ('${NOTZ_ELDER}', 'elder', 'Aziz', 'Not/AZone', 'ar'),
      ('${CARER}', 'family', 'Omar', 'Africa/Cairo', 'en'), ('${DOCTOR}', 'doctor', 'Hany', 'Africa/Cairo', 'en');
    insert into public.care_circles (id, elder_id) values ('00000000-0000-0000-0000-00000000c1c1', '${ELDER}');
    insert into public.care_circle_members values
      ('00000000-0000-0000-0000-00000000c1c1', '${CARER}', 'primary_caretaker', true, 'active'),
      ('00000000-0000-0000-0000-00000000c1c1', '${DOCTOR}', 'doctor', true, 'active');
    insert into public.reminders (elder_id, title, local_time) values
      ('${ELDER}', 'a Concor', '08:00'), ('${ELDER}', 'b Glucophage', '12:00'), ('${ELDER}', 'c Aspirin', '21:00'),
      ('${RIYADH_ELDER}', 'd Riyadh', '09:00'), ('${NOTZ_ELDER}', 'e NoZone', '09:00');
  `);
  // The bug, as live: events made with the old function (English → UTC, Arabic → Riyadh).
  await db.exec(`select public.materialize_reminder_events()`);
  // An answered future event is kept as it is, wrong time or not.
  await db.exec(`insert into public.reminder_events (reminder_id, elder_id, scheduled_at, status, responded_at)
    values (1, '${ELDER}', now() + interval '2 days', 'snoozed', now())`);
  await db.exec(migration(STEP32A));
  await db.exec(migration(STEP32C));
  await db.exec(migration(STEP32C));   // safe to apply twice
}, 60_000);

describe('step32c: help numbers', () => {
  it('the server\'s numbers are the founder-confirmed ones, exactly as in the app', async () => {
    const r = await db.query<{ v: unknown }>(`select value->'help_numbers' v from public.app_config where key = 'rafiq_chat'`);
    expect(r.rows[0].v).toEqual(HELP_NUMBERS);
    expect(HELP_NUMBERS.map((h) => h.phone)).toEqual(['123', '16328']);
  });
});

describe('step32c: crisis alerts hidden from doctors', () => {
  it('the elder and the caregiver see a crisis alert; the doctor does not; other alerts unchanged', async () => {
    await db.exec(`insert into public.health_alerts (elder_id, kind, severity, payload) values
      ('${ELDER}', 'sos', 'critical', '{"source":"rafiq_chat","reason":"crisis"}'),
      ('${ELDER}', 'sos', 'critical', '{"source":"manual_button"}')`);
    const seen = async (u: string) => (await asUser(db, u, () => db.query<{ s: string }>(
      `select payload->>'source' s from public.health_alerts order by s`))).rows.map((r) => r.s);
    expect(await seen(ELDER)).toEqual(['manual_button', 'rafiq_chat']);
    expect(await seen(CARER)).toEqual(['manual_button', 'rafiq_chat']);
    expect(await seen(DOCTOR)).toEqual(['manual_button']);
  });
  it('a doctor cannot acknowledge one either', async () => {
    const n = await asUser(db, DOCTOR, () => db.query(
      `update public.health_alerts set acknowledged_at = now() where payload->>'source' = 'rafiq_chat' returning id`));
    expect(n.rows).toHaveLength(0);
  });
});

describe('step32c: reminders at the elder\'s own time', () => {
  it('the test elder\'s next doses land at 08:00, 12:00 and 21:00 Cairo time', async () => {
    const pending = (await db.query<{ title: string; t: string }>(`
      select r.title, to_char(e.scheduled_at at time zone 'Africa/Cairo', 'HH24:MI') t
        from public.reminder_events e join public.reminders r on r.id = e.reminder_id
       where e.elder_id = '${ELDER}' and e.scheduled_at > now() and e.status = 'pending' order by r.title`)).rows;
    expect(pending).toEqual([{ title: 'a Concor', t: '08:00' }, { title: 'b Glucophage', t: '12:00' }, { title: 'c Aspirin', t: '21:00' }]);
  });
  it('an answered event is never touched', async () => {
    const r = await db.query(`select 1 from public.reminder_events where status = 'snoozed' and responded_at is not null`);
    expect(r.rows).toHaveLength(1);
  });
  it('each elder\'s own zone; a missing or bad zone falls back to Cairo', async () => {
    const riyadh = (await db.query<{ t: string }>(`select to_char(e.scheduled_at at time zone 'Asia/Riyadh', 'HH24:MI') t
      from public.reminder_events e where e.elder_id = '${RIYADH_ELDER}' and e.status = 'pending'`)).rows;
    expect(riyadh).toEqual([{ t: '09:00' }]);
    expect((await cairo(NOTZ_ELDER)).map((r) => r.t)).toEqual(['09:00']);
  });
  it('the function itself, across the day and the date line', async () => {
    const at = async (after: string) => (await db.query<{ t: string }>(
      `select to_char(public._reminder_next_local_time_run('${ELDER}', '08:00', '${after}') at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') t`)).rows[0].t;
    expect(await at('2026-11-05T05:00:00Z')).toBe('2026-11-05 08:00');   // 07:00 Cairo → today 08:00
    expect(await at('2026-11-05T06:30:00Z')).toBe('2026-11-06 08:00');   // 08:30 Cairo → tomorrow
    expect(await at('2026-11-05T23:30:00Z')).toBe('2026-11-06 08:00');   // 01:30 Cairo next day → that day
  });
});
