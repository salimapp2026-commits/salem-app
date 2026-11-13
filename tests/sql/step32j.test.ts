// step32j: Rafiq's check-in pushed to the elder at 10:00 / 19:00 local (off until
// switched on; quiet hours, 3-hour activity rule, at most 3 a day, once per slot, never
// late), and one low-mood notice a day to the family members with the health
// permission — never doctors.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { extractFunction, migration } from './harness';

const STEP32E = '20261101090400_step32e_reminders_to_elder.sql';
const STEP32J = '20261108090000_step32j_checkin_push_low_mood.sql';
const ELDER = '00000000-0000-0000-0000-0000000000e1';
const ELDER2 = '00000000-0000-0000-0000-0000000000e2';

// The live shapes (2026-11-08), reduced to what step32j touches.
const LIVE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.profiles (id uuid primary key, role text, display_name text, timezone text);
create table public.care_circles (id uuid primary key default gen_random_uuid(), elder_id uuid not null unique);
create table public.push_tokens (user_id uuid, onesignal_player_id text);
create table public.rafiq_activity (elder_id uuid primary key, last_at timestamptz not null);
create table public.app_config (key text primary key, value jsonb not null, description text);
create table public.rafiq_lines (id bigserial primary key, category text, lang text, text text, active boolean default true);
create table public.elder_moods (elder_id uuid not null, day date not null, mood smallint not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (elder_id, day));
create table public.test_edge_calls (slug text, body jsonb);
create function public._post_edge(p_slug text, p_body jsonb) returns bigint language sql security definer as
  $$ insert into public.test_edge_calls values (p_slug, p_body); select 1::bigint $$;
insert into public.app_config (key, value) values ('rafiq_chat',
  '{"enabled": true, "checkin_times": ["10:00", "19:00"], "quiet_start": "22:00", "quiet_end": "08:00", "max_checkins": 3}');
insert into public.rafiq_lines (category, lang, text) values
  ('checkin_morning', 'en', 'Good morning, {me}! Did you sleep well?'),
  ('checkin_morning', 'ar', 'صباح الخير يا {me}!'),
  ('checkin_evening', 'en', 'Good evening, {me}! How was your day?'),
  ('checkin_evening', 'ar', 'مساء الخير يا {me}!');
`;

let db: PGlite;
const calls = async () => (await db.query<{ body: Record<string, any> }>(`select body from public.test_edge_calls`)).rows.map((r) => r.body);
// "Cairo local time today at HH:MM" as a timestamptz expression.
const cairo = (hhmm: string, dayOffset = 0) =>
  `((current_date + ${dayOffset})::text || ' ${hhmm}')::timestamp at time zone 'Africa/Cairo'`;
const run = async (at: string) => Number((await db.query<{ n: number }>(`select public.dispatch_rafiq_checkins(${at}) n`)).rows[0].n);
const switchOn = () => db.exec(`update public.app_config set value = value || '{"checkin_push": true}' where key = 'rafiq_chat'`);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(LIVE);
  await db.exec(extractFunction(STEP32E, '_rafiq_fill'));
  await db.exec(extractFunction(STEP32E, '_rafiq_pick'));
  await db.exec(migration(STEP32J));
  await db.exec(migration(STEP32J));   // safe to apply twice
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    truncate public.profiles, public.care_circles, public.push_tokens, public.rafiq_activity, public.elder_moods,
      public.rafiq_checkin_pushes, public.test_edge_calls;
    update public.app_config set value = value || '{"checkin_push": false, "low_mood_notify": true}' where key = 'rafiq_chat';
    insert into public.profiles (id, role, display_name, timezone) values
      ('${ELDER}', 'elder', 'Mona Adel', 'Africa/Cairo'), ('${ELDER2}', 'elder', 'Hoda', 'Asia/Tokyo');
    insert into public.care_circles (elder_id) values ('${ELDER}'), ('${ELDER2}');
    insert into public.push_tokens values ('${ELDER}', 'p1');
  `);
});

describe('step32j: check-in push', () => {
  it('is off until switched on', async () => {
    expect(await run(cairo('10:02'))).toBe(0);
    expect(await calls()).toHaveLength(0);
  });
  it('10:00 local → one morning hello to the elder only, in Rafiq\'s voice; not again in the same slot', async () => {
    await switchOn();
    expect(await run(cairo('10:02'))).toBe(1);
    expect(await run(cairo('10:07'))).toBe(0);
    const [c] = await calls();
    expect(c).toMatchObject({ recipients: 'elder', severity: 'info', source_kind: 'rafiq', elder_id: ELDER,
      extra_data: { kind: 'checkin', slot: '10:00' }, ttl_seconds: 7200 });
    expect(c.texts.en.body).toBe('Good morning, Mona! Did you sleep well?');
    expect(c.texts.ar.body).toBe('صباح الخير يا Mona!');
  });
  it('19:00 is the evening line; the two slots make two pushes a day', async () => {
    await switchOn();
    await run(cairo('10:01'));
    await run(cairo('19:10'));
    const b = (await calls()).map((c) => c.texts.en.body);
    expect(b).toEqual(['Good morning, Mona! Did you sleep well?', 'Good evening, Mona! How was your day?']);
  });
  it('a slot more than 30 minutes late is skipped; before the slot nothing goes', async () => {
    await switchOn();
    expect(await run(cairo('10:31'))).toBe(0);
    expect(await run(cairo('09:59'))).toBe(0);
  });
  it('the elder\'s own time zone: 10:00 in Tokyo is not 10:00 in Cairo', async () => {
    await switchOn();
    await db.exec(`insert into public.push_tokens values ('${ELDER2}', 'p2')`);
    await run(`((current_date)::text || ' 10:02')::timestamp at time zone 'Asia/Tokyo'`);
    expect((await calls()).map((c) => c.elder_id)).toEqual([ELDER2]);
  });
  it('not if the elder talked to Rafiq in the last 3 hours', async () => {
    await switchOn();
    await db.exec(`insert into public.rafiq_activity values ('${ELDER}', ${cairo('08:00')})`);
    expect(await run(cairo('10:02'))).toBe(0);
    await db.exec(`update public.rafiq_activity set last_at = ${cairo('06:59')}`);
    expect(await run(cairo('10:02'))).toBe(1);
  });
  it('never in quiet hours, never more than max_checkins a day, never without a phone', async () => {
    await switchOn();
    await db.exec(`update public.app_config set value = value || '{"checkin_times": ["07:30", "10:00", "13:00", "16:00", "19:00", "22:30"]}' where key = 'rafiq_chat'`);
    for (const t of ['07:31', '10:01', '13:01', '16:01', '19:01', '22:31']) await run(cairo(t));
    expect((await calls()).map((c) => c.extra_data.slot)).toEqual(['10:00', '13:00', '16:00']);
    await db.exec(`truncate public.test_edge_calls, public.rafiq_checkin_pushes; delete from public.push_tokens`);
    expect(await run(cairo('10:01'))).toBe(0);
    await db.exec(`update public.app_config set value = value || '{"checkin_times": ["10:00", "19:00"]}' where key = 'rafiq_chat'`);
  });
  it('a new day starts again', async () => {
    await switchOn();
    expect(await run(cairo('10:02'))).toBe(1);
    expect(await run(cairo('10:02', 1))).toBe(1);
  });
  it('no name → the line without it', async () => {
    await switchOn();
    await db.exec(`update public.profiles set display_name = null where id = '${ELDER}'`);
    await run(cairo('10:02'));
    expect((await calls())[0].texts.en.body).toBe('Good morning! Did you sleep well?');
  });
  it('the app cannot call it', async () => {
    const r = await db.query<{ ok: boolean }>(
      `select has_function_privilege('authenticated', 'public.dispatch_rafiq_checkins(timestamptz)', 'execute') ok`);
    expect(r.rows[0].ok).toBe(false);
  });
});

describe('step32j: low-mood notice', () => {
  const mood = (m: number) => db.exec(`insert into public.elder_moods (elder_id, day, mood) values ('${ELDER}', current_date, ${m})
    on conflict (elder_id, day) do update set mood = excluded.mood`);

  it('"Not good" → one plain push to the family with the health permission, never doctors', async () => {
    await mood(1);
    const [c] = await calls();
    expect(c).toMatchObject({ severity: 'warning', source_kind: 'rafiq', exclude_roles: ['doctor'],
      extra_data: { kind: 'low_mood' }, elder_id: ELDER });
    expect(c.texts.en.body).toBe('Mona answered "Not good" to today\'s mood question. You may want to call and check in.');
    expect(c.texts.ar.body).toContain('Mona');
    expect(JSON.stringify(c)).not.toMatch(/critical/);
  });
  it('once a day: tapping again, or okay then not good again, sends nothing more', async () => {
    await mood(1);
    await mood(1);
    await mood(2);
    await mood(1);
    expect(await calls()).toHaveLength(1);
  });
  it('okay / good send nothing; okay then not good sends one', async () => {
    await mood(3);
    await mood(2);
    expect(await calls()).toHaveLength(0);
    await mood(1);
    expect(await calls()).toHaveLength(1);
  });
  it('switched off → nothing', async () => {
    await db.exec(`update public.app_config set value = value || '{"low_mood_notify": false}' where key = 'rafiq_chat'`);
    await mood(1);
    expect(await calls()).toHaveLength(0);
  });
  it('no name → still plain, no placeholder', async () => {
    await db.exec(`update public.profiles set display_name = '' where id = '${ELDER}'`);
    await mood(1);
    const [c] = await calls();
    expect(c.texts.en.body).toMatch(/^Your family member answered "Not good"/);
    expect(c.texts.ar.body).not.toMatch(/\{|null/);
  });
});
