// step32i: the elder and their primary caretaker add and stop medicines in the app;
// family members, doctors and strangers cannot — not through the functions, not by
// writing the table directly. A new medicine's next dose exists at once; stopping one
// closes its open doses quietly.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { asUser, migration } from './harness';

const STEP32I = '20261104090000_step32i_add_medicine.sql';
const ELDER = '00000000-0000-0000-0000-0000000000e1';
const PRIMARY = '00000000-0000-0000-0000-0000000000c1';
const FAMILY = '00000000-0000-0000-0000-0000000000f1';
const DOCTOR = '00000000-0000-0000-0000-0000000000d1';
const STRANGER = '00000000-0000-0000-0000-0000000000ff';
const OTHER_ELDER = '00000000-0000-0000-0000-0000000000e2';

// The live shapes (read from the catalog on 2026-11-04): reminders (uuid ids),
// reminder_events, the circle tables, is_in_circle, _reminder_next_local_time_run,
// and the old all-commands policy step32i replaces.
const LIVE = `
create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
create type public.circle_member_role as enum ('primary_caretaker','family','doctor');
create type public.circle_member_status as enum ('pending','active','removed');
create type public.reminder_kind as enum ('medication','meal','appointment','custom');
create type public.reminder_event_status as enum ('pending','done','skipped','snoozed','missed');
create table public.profiles (id uuid primary key, role text, display_name text, timezone text default 'UTC');
create table public.care_circles (id uuid primary key default gen_random_uuid(), elder_id uuid not null unique);
create table public.care_circle_members (circle_id uuid, user_id uuid, member_role public.circle_member_role,
  status public.circle_member_status default 'active');
create table public.reminders (id uuid primary key default uuid_generate_v4(), elder_id uuid not null,
  kind public.reminder_kind not null, title text not null, rrule text, local_time time, next_run_at timestamptz,
  medication_id uuid, voice_message_path text, active boolean not null default true, created_by uuid,
  created_at timestamptz not null default now());
create table public.reminder_events (id bigserial primary key, reminder_id uuid, elder_id uuid, scheduled_at timestamptz,
  status public.reminder_event_status default 'pending', responded_at timestamptz, responded_by uuid, notes text,
  dispatched_at timestamptz, reminders_sent smallint default 0, next_reminder_at timestamptz, missed_notified_at timestamptz);
create function public.is_in_circle(p_elder_id uuid) returns boolean language sql stable security definer
set search_path to 'public' as $$
  select exists (select 1 from public.care_circle_members m join public.care_circles c on c.id = m.circle_id
                  where c.elder_id = p_elder_id and m.user_id = auth.uid() and m.status = 'active');
$$;
create function public._reminder_next_local_time_run(p_elder_id uuid, p_local_time time, p_after timestamptz)
returns timestamptz language plpgsql stable set search_path to 'public' as $$
declare v_tz text; v_local_date date; v_candidate timestamptz;
begin
  select p.timezone into v_tz from public.profiles p where p.id = p_elder_id;
  if v_tz is null or not exists (select 1 from pg_timezone_names z where z.name = v_tz) then v_tz := 'Africa/Cairo'; end if;
  v_local_date := (p_after at time zone v_tz)::date;
  v_candidate := ((v_local_date::text || ' ' || p_local_time::text)::timestamp at time zone v_tz);
  if v_candidate <= p_after then
    v_candidate := (((v_local_date + 1)::text || ' ' || p_local_time::text)::timestamp at time zone v_tz);
  end if;
  return v_candidate;
end; $$;
alter table public.reminders enable row level security;
create policy reminders_rw on public.reminders for all
  using (elder_id = auth.uid() or public.is_in_circle(elder_id))
  with check (elder_id = auth.uid() or public.is_in_circle(elder_id));
`;

let db: PGlite;
const add = (who: string, times: string[], name = 'Concor', dose: string | null = '5 mg', elder = ELDER) =>
  asUser(db, who, () => db.query<{ ids: string[] }>(
    `select public.add_medicine($1, $2, $3, $4::time[]) ids`, [elder, name, dose, `{${times.join(',')}}`]));
const stop = (who: string, id: string) => asUser(db, who, () => db.query(`select public.stop_medicine($1)`, [id]));
const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(LIVE);
  await db.exec(migration(STEP32I));
  await db.exec(migration(STEP32I));   // safe to apply twice
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    truncate public.profiles, public.care_circles, public.care_circle_members, public.reminders, public.reminder_events restart identity;
    insert into public.profiles (id, role, display_name, timezone) values
      ('${ELDER}', 'elder', 'Mona Adel', 'Africa/Cairo'), ('${OTHER_ELDER}', 'elder', 'Hoda', 'Africa/Cairo'),
      ('${PRIMARY}', 'caregiver', 'Omar', 'Africa/Cairo'), ('${FAMILY}', 'caregiver', 'Sara', 'Africa/Cairo'),
      ('${DOCTOR}', 'doctor', 'Dr Ali', 'Africa/Cairo'), ('${STRANGER}', 'caregiver', 'X', 'Africa/Cairo');
    insert into public.care_circles (id, elder_id) values ('00000000-0000-0000-0000-00000000aa01', '${ELDER}'),
      ('00000000-0000-0000-0000-00000000aa02', '${OTHER_ELDER}');
    insert into public.care_circle_members (circle_id, user_id, member_role, status) values
      ('00000000-0000-0000-0000-00000000aa01', '${PRIMARY}', 'primary_caretaker', 'active'),
      ('00000000-0000-0000-0000-00000000aa01', '${FAMILY}', 'family', 'active'),
      ('00000000-0000-0000-0000-00000000aa01', '${DOCTOR}', 'doctor', 'active'),
      ('00000000-0000-0000-0000-00000000aa02', '${STRANGER}', 'primary_caretaker', 'removed');
  `);
});

describe('step32i: who may add a medicine', () => {
  it('the elder and the primary caretaker may; one daily reminder per time', async () => {
    expect((await add(ELDER, ['08:00', '20:00'])).rows[0].ids).toHaveLength(2);
    expect((await add(PRIMARY, ['14:00'], 'Aspirin', null)).rows[0].ids).toHaveLength(1);
    const r = await db.query<{ title: string; t: string; kind: string; created_by: string }>(
      `select title, local_time::text t, kind::text, created_by::text from public.reminders order by local_time`);
    expect(r.rows).toEqual([
      { title: 'Concor 5 mg', t: '08:00:00', kind: 'medication', created_by: ELDER },
      { title: 'Aspirin', t: '14:00:00', kind: 'medication', created_by: PRIMARY },
      { title: 'Concor 5 mg', t: '20:00:00', kind: 'medication', created_by: ELDER },
    ]);
  });
  it('family members, doctors, strangers and removed caretakers may not', async () => {
    for (const who of [FAMILY, DOCTOR, STRANGER]) {
      await expect(add(who, ['08:00']), who).rejects.toThrow(/no permission/);
    }
    await expect(add(STRANGER, ['08:00'], 'Concor', null, OTHER_ELDER)).rejects.toThrow(/no permission/);
    expect(await count(`select count(*) n from public.reminders`)).toBe(0);
  });
  it('nor can they write the table directly; everyone in the circle can still read it', async () => {
    await add(PRIMARY, ['08:00']);
    for (const who of [FAMILY, DOCTOR]) {
      await expect(asUser(db, who, () => db.query(
        `insert into public.reminders (elder_id, kind, title, local_time) values ('${ELDER}', 'medication', 'X', '09:00')`)),
      who).rejects.toThrow(/row-level security/);
      await asUser(db, who, () => db.query(`update public.reminders set active = false`));
      await asUser(db, who, () => db.query(`delete from public.reminders`));
      expect(await count(`select count(*) n from public.reminders where active`), who).toBe(1);
      expect((await asUser(db, who, () => db.query(`select id from public.reminders`))).rows, who).toHaveLength(1);
    }
    expect((await asUser(db, STRANGER, () => db.query(`select id from public.reminders`))).rows).toHaveLength(0);
  });
});

describe('step32i: what is saved', () => {
  it('the next dose exists at once, in the elder\'s time zone', async () => {
    const soon = (await db.query<{ t: string }>(
      `select to_char((now() + interval '10 minutes') at time zone 'Africa/Cairo', 'HH24:MI') t`)).rows[0].t;
    const [id] = (await add(ELDER, [soon])).rows[0].ids;
    const ev = await db.query<{ mins: number; status: string }>(
      `select round(extract(epoch from scheduled_at - now()) / 60) mins, status::text from public.reminder_events where reminder_id = $1`, [id]);
    expect(ev.rows).toHaveLength(1);
    expect(Number(ev.rows[0].mins)).toBeGreaterThanOrEqual(9);
    expect(Number(ev.rows[0].mins)).toBeLessThanOrEqual(10);
    expect(ev.rows[0].status).toBe('pending');
  });
  it('a time already past today starts tomorrow', async () => {
    const past = (await db.query<{ t: string }>(
      `select to_char((now() - interval '10 minutes') at time zone 'Africa/Cairo', 'HH24:MI') t`)).rows[0].t;
    const [id] = (await add(ELDER, [past])).rows[0].ids;
    const h = Number((await db.query<{ h: number }>(
      `select round(extract(epoch from scheduled_at - now()) / 3600) h from public.reminder_events where reminder_id = $1`, [id])).rows[0].h);
    expect(h).toBe(24);
  });
  it('the same time twice is one reminder; seconds are dropped', async () => {
    expect((await add(ELDER, ['08:00', '08:00:30', '08:00'])).rows[0].ids).toHaveLength(1);
  });
  it('refuses an empty or too long name, a too long dose, no times or more than 6', async () => {
    await expect(add(ELDER, ['08:00'], '   ')).rejects.toThrow(/invalid name/);
    await expect(add(ELDER, ['08:00'], 'x'.repeat(81))).rejects.toThrow(/invalid name/);
    await expect(add(ELDER, ['08:00'], 'Concor', 'x'.repeat(41))).rejects.toThrow(/invalid dose/);
    await expect(add(ELDER, [])).rejects.toThrow(/invalid times/);
    await expect(add(ELDER, ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'])).rejects.toThrow(/invalid times/);
    expect(await count(`select count(*) n from public.reminders`)).toBe(0);
  });
});

describe('step32i: stop', () => {
  it('the primary caretaker stops it: no more reminders, open doses closed quietly, answered ones kept', async () => {
    const [id] = (await add(ELDER, ['08:00'])).rows[0].ids;
    await db.exec(`insert into public.reminder_events (reminder_id, elder_id, scheduled_at, status) values
      ('${id}', '${ELDER}', now() - interval '1 day', 'done'),
      ('${id}', '${ELDER}', now() - interval '2 hours', 'snoozed')`);
    await stop(PRIMARY, id);
    expect(await count(`select count(*) n from public.reminders where active`)).toBe(0);
    const st = await db.query<{ status: string }>(`select status::text from public.reminder_events order by scheduled_at`);
    expect(st.rows.map((r) => r.status)).toEqual(['done', 'skipped', 'skipped']);
  });
  it('family members and doctors cannot stop it', async () => {
    const [id] = (await add(ELDER, ['08:00'])).rows[0].ids;
    for (const who of [FAMILY, DOCTOR, STRANGER]) {
      await expect(stop(who, id), who).rejects.toThrow(/no permission/);
    }
    expect(await count(`select count(*) n from public.reminders where active`)).toBe(1);
  });
  it('signed out, nothing works', async () => {
    await expect(db.query(`select public.add_medicine('${ELDER}', 'Concor', null, '{08:00}'::time[])`)).rejects.toThrow(/not signed in/);
  });
});
