// step32e: a medicine dose is pushed ONCE at its time, to the elder only, in Rafiq's
// voice with Taken / Not yet / Later; Not yet and Later remind again (at most 3 pushes);
// a late dose is not sent late; unanswered doses become missed after their last
// reminder; the server's lines and filling match the app's.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { asUser, migration } from './harness';
import { LINES } from '../../native/src/lib/rafiqChat/lines';
import { line } from '../../native/src/lib/rafiqChat/engine';

const STEP32A = '20261101090000_step32a_rafiq_chat.sql';
const STEP32E = '20261101090400_step32e_reminders_to_elder.sql';
const ELDER = '00000000-0000-0000-0000-0000000000e1';
const CARER = '00000000-0000-0000-0000-0000000000c1';

// The live shapes (2026-11-01): reminders, reminder_events, profiles, has_perm,
// _post_edge (stub: records each call), and the old functions step32e replaces.
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
  $$ select p_elder_id = auth.uid() or auth.uid() = '${CARER}' $$;
create table public.reminders (id bigserial primary key, elder_id uuid, kind public.reminder_kind default 'medication',
  title text, local_time time, active boolean default true);
create table public.reminder_events (id bigserial primary key, reminder_id bigint, elder_id uuid, scheduled_at timestamptz,
  status public.reminder_event_status default 'pending', responded_at timestamptz, responded_by uuid, notes text);
alter table public.reminder_events enable row level security;
create policy re_all on public.reminder_events for all using (elder_id = auth.uid() or auth.uid() = '${CARER}');
`;

let db: PGlite;
const calls = async () => (await db.query<{ body: Record<string, unknown> }>(`select body from public.test_edge_calls`)).rows.map((r) => r.body);
const dispatch = async () => (await db.query<{ n: number }>(`select public.dispatch_due_reminders(100) n`)).rows[0].n;
const event = async (id = 1) => (await db.query<{ status: string; reminders_sent: number }>(
  `select status, reminders_sent from public.reminder_events where id = ${id}`)).rows[0];
// "minutes ago" helpers
const ago = (m: number) => `now() - interval '${m} minutes'`;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(LIVE);
  await db.exec(migration(STEP32A));
  await db.exec(migration(STEP32E));
  await db.exec(migration(STEP32E));   // safe to apply twice
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    truncate public.profiles, public.reminders, public.reminder_events, public.test_edge_calls restart identity cascade;
    insert into public.profiles (id, role, display_name, timezone) values ('${ELDER}', 'elder', 'Mona Adel', 'Africa/Cairo'),
      ('${CARER}', 'family', 'Omar', 'Africa/Cairo');
    insert into public.reminders (elder_id, kind, title, local_time) values ('${ELDER}', 'medication', 'Concor 5 mg', '08:00');
    insert into public.reminder_events (reminder_id, elder_id, scheduled_at)
      values (1, '${ELDER}', date_trunc('minute', now()) - interval '1 minute');
  `);
});

describe('step32e: one push per dose, to the elder', () => {
  it('sent once at its time — never again on the next minute\'s run', async () => {
    expect(await dispatch()).toBe(1);
    expect(await dispatch()).toBe(0);
    expect(await dispatch()).toBe(0);
    expect(await calls()).toHaveLength(1);
    expect(await event()).toEqual({ status: 'pending', reminders_sent: 1 });
  });
  it('to the elder only, in Rafiq\'s voice, with Taken / Not yet / Later and the event id', async () => {
    await dispatch();
    const [c] = await calls();
    expect(c).toMatchObject({ recipients: 'elder', severity: 'info', source_kind: 'reminder', source_id: null, extra_data: { event_id: 1 }, ttl_seconds: 3600 });
    expect((c.buttons as { id: string }[]).map((b) => b.id)).toEqual(['taken', 'not_yet', 'later']);
    const texts = c.texts as Record<'en' | 'ar', { title: string; body: string }>;
    expect(texts.en.body).toContain('Concor 5 mg');
    expect(texts.ar.body).toContain('Concor 5 mg');
    expect(texts.en.body).not.toMatch(/\{\w+\}/);
    expect(texts.ar.body).not.toMatch(/\{\w+\}/);
  });
  it('a dose more than 30 minutes late is not sent late', async () => {
    await db.exec(`update public.reminder_events set scheduled_at = ${ago(45)}`);
    expect(await dispatch()).toBe(0);
  });
  it('a future dose waits; an answered one is never sent', async () => {
    await db.exec(`update public.reminder_events set scheduled_at = now() + interval '10 minutes'`);
    expect(await dispatch()).toBe(0);
    await db.exec(`update public.reminder_events set scheduled_at = ${ago(1)}, status = 'done'`);
    expect(await dispatch()).toBe(0);
  });
});

describe('step32e: Not yet / Later', () => {
  it('Not yet → again after 15 minutes; Later → after 60; at most 3 pushes', async () => {
    await dispatch();
    const snooze = (kind: string) => asUser(db, ELDER, () => db.query(`select public.reminder_snooze(1, '${kind}')`));
    await snooze('not_yet');
    expect((await event()).status).toBe('pending');
    expect(await dispatch()).toBe(0);                                         // not yet time
    const next = (await db.query<{ m: number }>(`select round(extract(epoch from next_reminder_at - now()) / 60) m from public.reminder_events`)).rows[0].m;
    expect(Number(next)).toBe(15);
    await db.exec(`update public.reminder_events set next_reminder_at = now() - interval '1 second', dispatched_at = now() - interval '20 minutes'`);
    expect(await dispatch()).toBe(1);                                         // second push
    await snooze('later');
    expect((await event()).status).toBe('snoozed');
    const later = (await db.query<{ m: number }>(`select round(extract(epoch from next_reminder_at - now()) / 60) m from public.reminder_events`)).rows[0].m;
    expect(Number(later)).toBe(60);
    await db.exec(`update public.reminder_events set next_reminder_at = now() - interval '1 second', dispatched_at = now() - interval '20 minutes'`);
    expect(await dispatch()).toBe(1);                                         // third push
    await snooze('not_yet');
    await db.exec(`update public.reminder_events set next_reminder_at = now() - interval '1 second', dispatched_at = now() - interval '20 minutes'`);
    expect(await dispatch()).toBe(0);                                         // max 3
    expect((await event()).reminders_sent).toBe(3);
  });
  it('the elder card\'s "remind me" (older apps: respond snoozed) also reminds again', async () => {
    await dispatch();
    await asUser(db, ELDER, () => db.query(`select public.reminder_event_respond(1, 'snoozed')`));
    await db.exec(`update public.reminder_events set next_reminder_at = now() - interval '1 second', dispatched_at = now() - interval '20 minutes'`);
    expect(await dispatch()).toBe(1);
  });
  it('Taken → done, and nothing more is sent; a done dose cannot be snoozed', async () => {
    await dispatch();
    await asUser(db, ELDER, () => db.query(`select public.reminder_event_respond(1, 'done')`));
    expect((await event()).status).toBe('done');
    await expect(asUser(db, ELDER, () => db.query(`select public.reminder_snooze(1, 'later')`))).rejects.toThrow(/already answered/);
  });
  it('only the elder or a read-health member can snooze; nonsense is refused', async () => {
    await expect(asUser(db, '00000000-0000-0000-0000-0000000000ff', () => db.query(`select public.reminder_snooze(1, 'later')`))).rejects.toThrow(/no permission/);
    await expect(asUser(db, ELDER, () => db.query(`select public.reminder_snooze(1, 'forever')`))).rejects.toThrow(/invalid snooze/);
  });
});

describe('step32e: missed', () => {
  it('missed 60 minutes after the last reminder; a snoozed dose waits for its next reminder', async () => {
    await db.exec(`update public.reminder_events set scheduled_at = ${ago(61)}`);
    await db.exec(`insert into public.reminder_events (reminder_id, elder_id, scheduled_at, status, next_reminder_at)
      values (1, '${ELDER}', ${ago(90)}, 'snoozed', now() + interval '10 minutes')`);
    await db.query(`select public.expire_stale_reminder_events()`);
    expect((await event(1)).status).toBe('missed');
    expect((await event(2)).status).toBe('snoozed');
  });
});

describe('step32e: lines', () => {
  it('the server\'s reminder lines are the app\'s, in both languages', async () => {
    for (const lang of ['en', 'ar'] as const) {
      const r = await db.query<{ text: string }>(`select text from public.rafiq_lines where category = 'reminder_dose' and lang = '${lang}' order by id`);
      expect(r.rows.map((x) => x.text)).toEqual(LINES.reminder_dose[lang]);
    }
  });
  it('the server fills a line exactly as the app does — with a name and without', async () => {
    for (const lang of ['en', 'ar'] as const) {
      for (const [i, raw] of LINES.reminder_dose[lang].entries()) {
        const pick = () => (i + 0.5) / LINES.reminder_dose[lang].length;
        for (const me of ['Mona', '']) {
          const js = line(LINES, 'reminder_dose', lang, { me, med: 'Concor 5 mg', time: '08:00' }, pick);
          const sql = (await db.query<{ t: string }>(`select public._rafiq_fill($1, $2, 'Concor 5 mg', '08:00') t`, [raw, me])).rows[0].t;
          expect(sql, `${lang} #${i} me="${me}"`).toBe(js);
        }
      }
    }
  });
});
