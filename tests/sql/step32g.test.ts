// step32g: the push log accepts reminder / missed-dose / Rafiq pushes; a phone's push
// subscription belongs to ONE account — the last that saved it.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { asUser, migration } from './harness';

const STEP32G = '20261101090600_step32g_push_device_and_log.sql';
const ELDER = '00000000-0000-0000-0000-0000000000e1';
const CARER = '00000000-0000-0000-0000-0000000000c1';
const OTHER = '00000000-0000-0000-0000-0000000000c2';

// The live shape of push_tokens (2026-11-01), with its RLS policy.
const LIVE = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table public.profiles (id uuid primary key);
create table public.push_tokens (id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios','android','web')),
  onesignal_player_id text, token text, last_seen_at timestamptz not null default now(),
  unique (user_id, onesignal_player_id), unique (user_id, token));
alter table public.push_tokens enable row level security;
create policy push_self on public.push_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on public.push_tokens to authenticated;
insert into public.profiles values ('${ELDER}'), ('${CARER}'), ('${OTHER}');
create table public.notification_log (id uuid primary key default gen_random_uuid(), elder_id uuid, recipient_user_id uuid,
  channel text check (channel in ('push','sms','email','in_app')),
  source_kind text constraint notification_log_source_kind_check
    check (source_kind in ('health_alert','sos','ai_assessment','system','trend')),
  body_ar text);
`;

let db: PGlite;
let afterApply: { user_id: string; onesignal_player_id: string }[] = [];
const owners = async (pid: string) => (await db.query<{ user_id: string }>(
  `select user_id from public.push_tokens where onesignal_player_id = $1 order by user_id`, [pid])).rows.map((r) => r.user_id);
const save = (user: string, pid: string) => asUser(db, user, () => db.query(
  `insert into public.push_tokens (user_id, platform, onesignal_player_id) values ($1, 'android', $2)
   on conflict (user_id, onesignal_player_id) do update set last_seen_at = now()`, [user, pid]));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(LIVE);
  // The duplicate found on the emulator, before the fix.
  await db.exec(`insert into public.push_tokens (user_id, platform, onesignal_player_id, last_seen_at) values
    ('${CARER}', 'android', 'phone-1', now() - interval '2 minutes'),
    ('${ELDER}', 'android', 'phone-1', now()),
    ('${OTHER}', 'android', 'phone-2', now())`);
  await db.exec(migration(STEP32G));
  await db.exec(migration(STEP32G));   // safe to apply twice
  afterApply = (await db.query<{ user_id: string; onesignal_player_id: string }>(
    `select user_id, onesignal_player_id from public.push_tokens order by onesignal_player_id`)).rows;
}, 60_000);

beforeEach(async () => {
  await db.exec(`truncate public.push_tokens`);
});

describe('step32g: the push log', () => {
  it('accepts the kinds the server sends, and still refuses nonsense', async () => {
    for (const k of ['health_alert', 'sos', 'trend', 'rafiq', 'reminder', 'reminder_missed']) {
      await db.query(`insert into public.notification_log (channel, source_kind) values ('push', $1)`, [k]);
    }
    await expect(db.query(`insert into public.notification_log (channel, source_kind) values ('push', 'nonsense')`)).rejects.toThrow(/source_kind_check/);
  });
  it('every source_kind a migration sends to notify-fanout is allowed (a new one needs the check widened)', async () => {
    const dir = join(__dirname, '../../supabase/migrations');
    const sent = new Set<string>();
    for (const f of readdirSync(dir)) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/'source_kind',\s*'([a-z_]+)'/g)) sent.add(m[1]);
    }
    expect(sent.size).toBeGreaterThan(3);
    for (const k of sent) {
      await expect(db.query(`insert into public.notification_log (channel, source_kind) values ('push', $1)`, [k]), k).resolves.toBeTruthy();
    }
  });
});

describe('step32g: one account per phone', () => {
  it('applying it removes existing duplicates, keeping the most recent sign-in', () => {
    expect(afterApply).toEqual([{ user_id: ELDER, onesignal_player_id: 'phone-1' }, { user_id: OTHER, onesignal_player_id: 'phone-2' }]);
  });
  it('the next account to sign in on a phone takes it over — as the app saves it, under RLS', async () => {
    await save(CARER, 'phone-1');
    expect(await owners('phone-1')).toEqual([CARER]);
    await save(ELDER, 'phone-1');
    expect(await owners('phone-1')).toEqual([ELDER]);
    await save(CARER, 'phone-1');
    expect(await owners('phone-1')).toEqual([CARER]);
  });
  it('the same account on two phones keeps both; other phones are untouched', async () => {
    await save(CARER, 'phone-1');
    await save(CARER, 'phone-3');
    await save(OTHER, 'phone-2');
    await save(ELDER, 'phone-1');
    expect(await owners('phone-3')).toEqual([CARER]);
    expect(await owners('phone-2')).toEqual([OTHER]);
  });
  it('sign-out: the app can remove only its own row', async () => {
    await save(CARER, 'phone-1');
    await save(OTHER, 'phone-2');
    await asUser(db, ELDER, () => db.query(`delete from public.push_tokens`));
    expect(await owners('phone-1')).toEqual([CARER]);
    await asUser(db, CARER, () => db.query(`delete from public.push_tokens where onesignal_player_id = 'phone-1'`));
    expect(await owners('phone-1')).toEqual([]);
    expect(await owners('phone-2')).toEqual([OTHER]);
  });
  it('the app cannot call the trigger function directly', async () => {
    const g = await db.query<{ a: boolean }>(`select has_function_privilege('authenticated', 'public._push_token_one_owner()', 'execute') a`);
    expect(g.rows[0].a).toBe(false);
  });
});
