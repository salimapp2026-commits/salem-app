// step32f (+ step32h: a stopped medicine is never "missed"): when a medicine dose becomes missed (after all the elder's reminders), the
// primary caretaker gets ONE push, plain words, normal urgency; a server switch turns
// it off; a long-stale dose is marked missed but not pushed late.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migration } from './harness';

const STEP32A = '20261101090000_step32a_rafiq_chat.sql';
const STEP32E = '20261101090400_step32e_reminders_to_elder.sql';
const STEP32F = '20261101090500_step32f_missed_dose_to_primary.sql';
const STEP32H = '20261101090700_step32h_stopped_medicine_not_missed.sql';
const ELDER = '00000000-0000-0000-0000-0000000000e1';

// The live shapes (2026-11-01), as in step32e.test.ts.
const LIVE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
create type public.alert_kind as enum ('sos');
create type public.alert_severity as enum ('info','warning','critical');
create type public.circle_member_role as enum ('primary_caretaker','family','doctor');
create type public.circle_member_status as enum ('pending','active','removed');
create type public.reminder_kind as enum ('medication','meal','appointment','custom');
create type public.reminder_event_status as enum ('pending','done','skipped','snoozed','missed');
create table public.profiles (id uuid primary key, role text, display_name text, timezone text default 'UTC');
create table public.care_circles (id uuid primary key default gen_random_uuid(), elder_id uuid not null unique);
create table public.care_circle_members (circle_id uuid, user_id uuid, member_role public.circle_member_role,
  can_read_health boolean default true, status public.circle_member_status default 'active');
create table public.health_alerts (id uuid primary key default gen_random_uuid(), elder_id uuid, kind public.alert_kind,
  severity public.alert_severity, payload jsonb default '{}', created_at timestamptz default now());
create table public.test_edge_calls (slug text, body jsonb);
create function public._post_edge(p_slug text, p_body jsonb) returns bigint language sql security definer as
  $$ insert into public.test_edge_calls values (p_slug, p_body); select 1::bigint $$;
create function public._emergency_location(p_alert uuid, p_elder uuid) returns jsonb language sql as $$ select null::jsonb $$;
create function public.has_perm(p_elder_id uuid, p_perm text) returns boolean language sql stable security definer as
  $$ select p_elder_id = auth.uid() $$;
create table public.reminders (id bigserial primary key, elder_id uuid, kind public.reminder_kind default 'medication',
  title text, local_time time, active boolean default true);
create table public.reminder_events (id bigserial primary key, reminder_id bigint, elder_id uuid, scheduled_at timestamptz,
  status public.reminder_event_status default 'pending', responded_at timestamptz, responded_by uuid, notes text);
`;

let db: PGlite;
const calls = async () => (await db.query<{ body: Record<string, unknown> }>(
  `select body from public.test_edge_calls`)).rows.map((r) => r.body);
const expire = async () => (await db.query<{ n: number }>(`select public.expire_stale_reminder_events() n`)).rows[0].n;
const ago = (m: number) => `now() - interval '${m} minutes'`;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(LIVE);
  await db.exec(migration(STEP32A));
  await db.exec(migration(STEP32E));
  await db.exec(migration(STEP32F));
  await db.exec(migration(STEP32F));   // safe to apply twice
  await db.exec(migration(STEP32H));
  await db.exec(migration(STEP32H));   // safe to apply twice
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    truncate public.profiles, public.reminders, public.reminder_events, public.test_edge_calls restart identity cascade;
    update public.app_config set value = value || '{"missed_notify_primary": true}' where key = 'reminders';
    insert into public.profiles (id, role, display_name, timezone) values ('${ELDER}', 'elder', 'Mona Adel', 'Africa/Cairo');
    insert into public.reminders (elder_id, kind, title, local_time) values ('${ELDER}', 'medication', 'Concor 5 mg', '08:00'),
      ('${ELDER}', 'appointment', 'Dentist', '10:00');
    -- Unanswered after its reminders: missed now.
    insert into public.reminder_events (reminder_id, elder_id, scheduled_at) values (1, '${ELDER}', ${ago(61)});
  `);
});

describe('step32f: a missed dose → one push to the primary caretaker', () => {
  it('one push, normal urgency, routed to primary caretakers only, in plain words', async () => {
    expect(await expire()).toBe(1);
    const all = await calls();
    expect(all).toHaveLength(1);
    const c = all[0];
    // 'info' is the severity get_alert_recipients sends to primary caretakers only.
    expect(c).toMatchObject({ elder_id: ELDER, severity: 'info', source_kind: 'reminder_missed', extra_data: { event_id: 1 } });
    expect(c.recipients).toBeUndefined();                       // not the elder
    expect(c.exclude_roles).toEqual(['family', 'doctor']);
    expect(c.buttons).toBeUndefined();
    const texts = c.texts as Record<'en' | 'ar', { title: string; body: string }>;
    expect(texts.en.title).toBe('Missed dose');
    expect(texts.en.body).toMatch(/^Mona hasn't confirmed taking Concor 5 mg \(\d\d:\d\d\)\. You may want to check in\.$/);
    expect(texts.ar.body).toContain('Concor 5 mg');
    expect(texts.ar.body).toContain('Mona');
    for (const t of [texts.en.body, texts.ar.body]) expect(t).not.toMatch(/SOS|emergency|طوارئ/i);
  });
  it('the time is in the elder\'s own time zone, not the server\'s', async () => {
    await db.exec(`update public.reminder_events set scheduled_at = date_trunc('minute', now()) - interval '90 minutes'`);
    for (const tz of ['Africa/Cairo', 'Asia/Tokyo']) {
      await db.exec(`truncate public.test_edge_calls; update public.reminder_events set status = 'pending';
        update public.profiles set timezone = '${tz}'`);
      await expire();
      const want = (await db.query<{ t: string }>(`select to_char(scheduled_at at time zone '${tz}', 'HH24:MI') t from public.reminder_events`)).rows[0].t;
      const [c] = await calls();
      expect((c.texts as Record<'en', { body: string }>).en.body).toContain(`(${want})`);
    }
  });
  it('only once: the next runs send nothing more', async () => {
    await expire();
    expect(await expire()).toBe(0);
    expect(await expire()).toBe(0);
    expect(await calls()).toHaveLength(1);
    const r = (await db.query<{ status: string; n: boolean }>(`select status, missed_notified_at is not null n from public.reminder_events`)).rows[0];
    expect(r).toEqual({ status: 'missed', n: true });
  });
  it('not yet missed (still within its reminders, or snoozed) → nothing', async () => {
    await db.exec(`update public.reminder_events set scheduled_at = ${ago(30)}`);
    await db.exec(`insert into public.reminder_events (reminder_id, elder_id, scheduled_at, status, next_reminder_at)
      values (1, '${ELDER}', ${ago(120)}, 'snoozed', now() + interval '5 minutes')`);
    expect(await expire()).toBe(0);
    expect(await calls()).toHaveLength(0);
  });
  it('answered doses never notify', async () => {
    await db.exec(`update public.reminder_events set status = 'done'`);
    expect(await expire()).toBe(0);
    expect(await calls()).toHaveLength(0);
  });
  it('a dose missed long ago (server was down) is marked missed but not pushed late', async () => {
    await db.exec(`update public.reminder_events set scheduled_at = ${ago(8 * 60)}`);
    expect(await expire()).toBe(1);
    expect(await calls()).toHaveLength(0);
  });
  it('only medicine: other reminders become missed silently', async () => {
    await db.exec(`update public.reminder_events set reminder_id = 2`);
    expect(await expire()).toBe(1);
    expect(await calls()).toHaveLength(0);
  });
  it('the server switch turns it off (and the dose is still marked missed)', async () => {
    await db.exec(`update public.app_config set value = value || '{"missed_notify_primary": false}' where key = 'reminders'`);
    expect(await expire()).toBe(1);
    expect(await calls()).toHaveLength(0);
  });
  it('without a name the words still read well', async () => {
    await db.exec(`update public.profiles set display_name = null`);
    await expire();
    const [c] = await calls();
    const texts = c.texts as Record<'en' | 'ar', { body: string }>;
    expect(texts.en.body).toMatch(/^Concor 5 mg \(\d\d:\d\d\) hasn't been confirmed as taken\./);
    expect(texts.ar.body).not.toContain('عند');
  });
  it('step32h: a stopped medicine is closed as skipped — no "missed", no push', async () => {
    await db.exec(`update public.reminders set active = false where id = 1`);
    await db.exec(`insert into public.reminder_events (reminder_id, elder_id, scheduled_at)
      values (1, '${ELDER}', now() + interval '1 hour')`);   // a future dose stays as it is
    expect(await expire()).toBe(0);
    expect(await calls()).toHaveLength(0);
    const rows = (await db.query<{ status: string }>(`select status from public.reminder_events order by id`)).rows;
    expect(rows.map((r) => r.status)).toEqual(['skipped', 'pending']);
  });
  it('the app cannot call it; the setting is on by default', async () => {
    const g = await db.query<{ a: boolean }>(`select has_function_privilege('authenticated', 'public.expire_stale_reminder_events()', 'execute') a`);
    expect(g.rows[0].a).toBe(false);
    const v = await db.query<{ v: boolean }>(`select (value->>'missed_notify_primary')::boolean v from public.app_config where key = 'reminders'`);
    expect(v.rows[0].v).toBe(true);
  });
});
