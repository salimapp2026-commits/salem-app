// step32n: the low-mood push's fallback fields (title_ar / body_ar) are Arabic; step32l's
// behaviour (the elder's setting, the server switch) is unchanged.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { asUser, extractFunction, migration } from './harness';

const STEP32E = '20261101090400_step32e_reminders_to_elder.sql';
const STEP32J = '20261108090000_step32j_checkin_push_low_mood.sql';
const STEP32L = '20261108090200_step32l_elder_mood_notice_setting.sql';
const STEP32N = '20261108090400_step32n_low_mood_arabic_fallback.sql';
const ELDER = '00000000-0000-0000-0000-0000000000e1';
const OTHER = '00000000-0000-0000-0000-0000000000e2';

const LIVE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
grant usage on schema public to authenticated;
create table public.profiles (id uuid primary key, role text, display_name text, timezone text);
alter table public.profiles enable row level security;
grant select, update on public.profiles to authenticated;
create policy profiles_self_rw on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
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
insert into public.app_config (key, value) values ('rafiq_chat', '{"enabled": true}');
`;

let db: PGlite;
const sent = async () => (await db.query(`select 1 from public.test_edge_calls`)).rows.length;
const mood = (m: number) => db.exec(`insert into public.elder_moods (elder_id, day, mood) values ('${ELDER}', current_date, ${m})
  on conflict (elder_id, day) do update set mood = excluded.mood`);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(LIVE);
  await db.exec(extractFunction(STEP32E, '_rafiq_fill'));
  await db.exec(extractFunction(STEP32E, '_rafiq_pick'));
  await db.exec(migration(STEP32J));
  await db.exec(migration(STEP32L));
  await db.exec(migration(STEP32N));
  await db.exec(migration(STEP32N));   // safe to apply twice
}, 60_000);

beforeEach(async () => {
  await db.exec(`truncate public.profiles, public.elder_moods, public.test_edge_calls cascade;
    update public.app_config set value = value || '{"low_mood_notify": true}' where key = 'rafiq_chat';
    insert into public.profiles (id, role, display_name) values ('${ELDER}', 'elder', 'Mona'), ('${OTHER}', 'elder', 'Hoda');`);
});

describe('step32n: Arabic fallback fields', () => {
  it('title_ar / body_ar are the Arabic texts; the per-language texts are unchanged', async () => {
    await mood(1);
    const c = (await db.query<{ body: Record<string, any> }>(`select body from public.test_edge_calls`)).rows[0].body;
    expect(c.title_ar).toBe(c.texts.ar.title);
    expect(c.body_ar).toBe(c.texts.ar.body);
    expect(c.body_ar).toContain('مش بخير');
    expect(c.texts.en.body).toBe('Mona answered "Not good" to today\'s mood question. You may want to call and check in.');
  });
});

describe('step32l behaviour after step32n', () => {
  it('on by default: "Not good" notifies the family, as in step32j', async () => {
    const r = await db.query<{ v: boolean }>(`select mood_notify_family v from public.profiles where id = '${ELDER}'`);
    expect(r.rows[0].v).toBe(true);
    await mood(1);
    expect(await sent()).toBe(1);
  });
  it('the elder turns it off on their own profile → no push, the mood is still saved', async () => {
    await asUser(db, ELDER, () => db.query(`update public.profiles set mood_notify_family = false where id = '${ELDER}'`));
    await mood(1);
    expect(await sent()).toBe(0);
    expect((await db.query(`select mood from public.elder_moods where elder_id = '${ELDER}'`)).rows).toEqual([{ mood: 1 }]);
  });
  it('nobody else can change it for them', async () => {
    await asUser(db, OTHER, () => db.query(`update public.profiles set mood_notify_family = false where id = '${ELDER}'`));
    const r = await db.query<{ v: boolean }>(`select mood_notify_family v from public.profiles where id = '${ELDER}'`);
    expect(r.rows[0].v).toBe(true);
  });
  it('the server-wide switch still turns it off for everyone', async () => {
    await db.exec(`update public.app_config set value = value || '{"low_mood_notify": false}' where key = 'rafiq_chat'`);
    await mood(1);
    expect(await sent()).toBe(0);
  });
});
