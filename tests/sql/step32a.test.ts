// step32a: Rafiq's chat settings and lines readable by signed-in users only; mood
// readable by the elder and caregivers with the health permission, never doctors;
// the crisis alert reaches caregivers only, carries no words, and pushes at most
// once per 30 minutes. The seeded settings equal the app's built-in copy.
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { asUser, migration } from './harness';
import { DEFAULT_CONFIG } from '../../native/src/lib/rafiqChat/lines';

const STEP32A = '20261101090000_step32a_rafiq_chat.sql';
const ELDER = '00000000-0000-0000-0000-0000000000e1';
const CARER = '00000000-0000-0000-0000-0000000000c1';
const DOCTOR = '00000000-0000-0000-0000-0000000000d1';
const STRANGER = '00000000-0000-0000-0000-0000000000f1';

// The tables step32a touches, as live on salem-prod (read 2026-11-01).
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

create type public.alert_kind as enum ('sos','fall_detected','rafiq');
create type public.alert_severity as enum ('info','warning','critical');
create type public.circle_member_role as enum ('primary_caretaker','family','doctor');
create type public.circle_member_status as enum ('pending','active','revoked');
create table public.profiles (id uuid primary key, role text, display_name text);
create table public.care_circles (id uuid primary key default gen_random_uuid(), elder_id uuid not null unique);
create table public.care_circle_members (circle_id uuid, user_id uuid, member_role public.circle_member_role,
  can_read_health boolean default true, status public.circle_member_status default 'active');
create table public.health_alerts (id uuid primary key default gen_random_uuid(), elder_id uuid not null,
  kind public.alert_kind not null, severity public.alert_severity not null, payload jsonb not null default '{}',
  created_at timestamptz not null default now());
create table public.test_edge_calls (slug text, body jsonb);
create function public._post_edge(p_slug text, p_body jsonb) returns bigint language sql security definer as
  $$ insert into public.test_edge_calls values (p_slug, p_body); select 1::bigint $$;
create function public._emergency_location(p_alert uuid, p_elder uuid) returns jsonb language sql as
  $$ select jsonb_build_object('lat', 30.0, 'lon', 31.2) $$;
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(LIVE);
  await db.exec(`
    insert into public.profiles values ('${ELDER}', 'elder', 'Mona Adel'), ('${CARER}', 'caregiver', 'Omar'),
      ('${DOCTOR}', 'doctor', 'Hany'), ('${STRANGER}', 'caregiver', 'X');
    insert into public.care_circles (id, elder_id) values ('00000000-0000-0000-0000-00000000c1c1', '${ELDER}');
    insert into public.care_circle_members values
      ('00000000-0000-0000-0000-00000000c1c1', '${CARER}', 'primary_caretaker', true, 'active'),
      ('00000000-0000-0000-0000-00000000c1c1', '${DOCTOR}', 'doctor', true, 'active');
  `);
  await db.exec(migration(STEP32A));
  await db.exec(migration(STEP32A));   // safe to apply twice
}, 60_000);

describe('step32a: settings and lines', () => {
  it('the seeded rafiq_chat settings are the app\'s built-in ones (help numbers: step32c)', async () => {
    const r = await db.query<{ value: Record<string, unknown> }>(`select value from public.app_config where key = 'rafiq_chat'`);
    const { help_numbers: _seededPlaceholders, ...seeded } = r.rows[0].value;
    const { help_numbers: _builtIn, ...builtIn } = DEFAULT_CONFIG;
    expect(seeded).toEqual(builtIn);
  });
  it('signed-in users read settings and active lines; anon reads nothing; nobody writes', async () => {
    await db.exec(`insert into public.rafiq_lines (category, lang, text, active) values ('greeting','en','Hi {me}!', true), ('greeting','en','old', false)`);
    const lines = await asUser(db, CARER, () => db.query(`select text from public.rafiq_lines`));
    expect(lines.rows).toEqual([{ text: 'Hi {me}!' }]);
    await expect(asUser(db, ELDER, () => db.exec(`update public.app_config set value = '{}'`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ELDER, () => db.exec(`insert into public.rafiq_lines (category, lang, text) values ('x','en','y')`))).rejects.toThrow(/permission denied/);
    await db.exec(`set role anon`);
    await expect(db.query(`select * from public.app_config`)).rejects.toThrow(/permission denied/);
    await db.exec(`reset role`);
  });
});

describe('step32a: mood', () => {
  it('only the elder records it; one per day, replaced by a second tap', async () => {
    await asUser(db, ELDER, () => db.exec(`select public.record_mood(2::smallint, current_date)`));
    await asUser(db, ELDER, () => db.exec(`select public.record_mood(3::smallint, current_date)`));
    const r = await db.query<{ mood: number }>(`select mood from public.elder_moods where elder_id = '${ELDER}'`);
    expect(r.rows).toEqual([{ mood: 3 }]);
    await expect(asUser(db, CARER, () => db.exec(`select public.record_mood(1::smallint, current_date)`))).rejects.toThrow(/elders_only/);
    await expect(asUser(db, ELDER, () => db.exec(`select public.record_mood(4::smallint, current_date)`))).rejects.toThrow(/bad_mood/);
    await expect(asUser(db, ELDER, () => db.exec(`select public.record_mood(1::smallint, current_date - 9)`))).rejects.toThrow(/bad_day/);
  });
  it('the elder and the caregiver see it; the doctor and strangers never do', async () => {
    const see = async (u: string) => (await asUser(db, u, () => db.query(`select mood from public.elder_moods`))).rows.length;
    expect(await see(ELDER)).toBe(1);
    expect(await see(CARER)).toBe(1);
    expect(await see(DOCTOR)).toBe(0);
    expect(await see(STRANGER)).toBe(0);
  });
});

describe('step32a: crisis alert', () => {
  it('only the elder raises it; caregivers are pushed, doctors excluded; no words anywhere', async () => {
    await expect(asUser(db, CARER, () => db.query(`select public.raise_crisis_alert()`))).rejects.toThrow(/elders_only/);
    const id = (await asUser(db, ELDER, () => db.query<{ id: string }>(`select public.raise_crisis_alert() as id`))).rows[0].id;
    const a = await db.query<{ kind: string; severity: string; payload: Record<string, unknown> }>(
      `select kind, severity, payload from public.health_alerts where id = '${id}'`);
    expect(a.rows[0]).toMatchObject({ kind: 'sos', severity: 'critical' });
    expect(a.rows[0].payload).toEqual({ source: 'rafiq_chat', reason: 'crisis', no_fanout: true, raised_by: ELDER });
    const calls = await db.query<{ slug: string; body: Record<string, unknown> }>(`select * from public.test_edge_calls`);
    expect(calls.rows).toHaveLength(1);
    expect(calls.rows[0].slug).toBe('notify-fanout');
    expect(calls.rows[0].body.exclude_roles).toEqual(['doctor']);
    expect(JSON.stringify(calls.rows[0].body)).toContain('Mona may need you now');
  });
  it('a second one within 30 minutes returns the same alert and pushes nothing new', async () => {
    const before = (await db.query(`select * from public.test_edge_calls`)).rows.length;
    const a = (await asUser(db, ELDER, () => db.query<{ id: string }>(`select public.raise_crisis_alert() as id`))).rows[0].id;
    const b = (await asUser(db, ELDER, () => db.query<{ id: string }>(`select public.raise_crisis_alert() as id`))).rows[0].id;
    expect(a).toBe(b);
    expect((await db.query(`select * from public.test_edge_calls`)).rows.length).toBe(before);
  });
});

describe('step32a: talked to Rafiq', () => {
  it('the elder\'s own marker; caregivers cannot read it', async () => {
    await asUser(db, ELDER, () => db.exec(`select public.rafiq_touch()`));
    await asUser(db, CARER, () => db.exec(`select public.rafiq_touch()`));   // not an elder: no row
    expect((await db.query(`select elder_id from public.rafiq_activity`)).rows).toEqual([{ elder_id: ELDER }]);
    expect((await asUser(db, CARER, () => db.query(`select * from public.rafiq_activity`))).rows).toEqual([]);
  });
});
