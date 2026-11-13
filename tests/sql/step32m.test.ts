// step32m: the nightly location clean-up never deletes an elder's newest position of
// any source — band fixes included; step32k's rules otherwise unchanged.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migration } from './harness';

const STEP32K = '20261108090100_step32k_phone_location_retention.sql';
const STEP32M = '20261108090300_step32m_keep_newest_location_any_source.sql';
const A = '00000000-0000-0000-0000-0000000000e1';
const B = '00000000-0000-0000-0000-0000000000e2';

// The live shapes (2026-11-08), reduced; location_pings without its PostGIS column.
const LIVE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.trend_config (key text primary key, value numeric not null, description text);
insert into public.trend_config values ('band_location_retention_days', 30, ''), ('alert_location_retention_days', 365, '');
create function public._band_cfg(p_key text, p_default numeric) returns numeric language sql stable security definer
  set search_path to 'public' as $$ select coalesce((select value from public.trend_config where key = p_key), p_default) $$;
create table public.location_pings (id bigserial primary key, elder_id uuid not null, captured_at timestamptz not null,
  source text not null check (source in ('fg', 'bg', 'band_gps')));
create table public.health_alerts (id uuid primary key default gen_random_uuid(), created_at timestamptz default now());
create table public.alert_locations (alert_id uuid primary key, elder_id uuid);
create table public.audit_log (actor_id uuid, action text, resource_type text, resource_id uuid, elder_id uuid, payload jsonb);
`;

let db: PGlite;
const ping = (elder: string, daysAgo: number, source = 'fg') =>
  db.exec(`insert into public.location_pings (elder_id, captured_at, source) values ('${elder}', now() - interval '${daysAgo} days', '${source}')`);
const left = async (elder: string) => (await db.query<{ d: number }>(
  `select round(extract(epoch from now() - captured_at) / 86400) d from public.location_pings where elder_id = '${elder}' order by captured_at`))
  .rows.map((r) => Number(r.d));
const purge = async () => (await db.query<{ r: Record<string, number> }>(`select public.location_purge() r`)).rows[0].r;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(LIVE);
  await db.exec(migration(STEP32K));
  await db.exec(migration(STEP32M));
  await db.exec(migration(STEP32M));   // safe to apply twice
}, 60_000);

beforeEach(async () => {
  await db.exec(`truncate public.location_pings, public.health_alerts, public.alert_locations, public.audit_log restart identity`);
});

const sources = async (elder: string) => (await db.query<{ s: string }>(
  `select source s from public.location_pings where elder_id = '${elder}' order by captured_at`)).rows.map((r) => r.s);

describe('step32m: the newest position of any source is never deleted', () => {
  it('newest is a band fix: the older phone position goes, the band fix stays — run after run', async () => {
    await ping(A, 40);
    await ping(A, 35, 'band_gps');
    await purge();
    expect(await sources(A)).toEqual(['band_gps']);
    await purge();
    expect(await sources(A)).toEqual(['band_gps']);
  });
  it('only old band fixes: the newest one stays', async () => {
    await ping(B, 50, 'band_gps');
    await ping(B, 40, 'band_gps');
    const r = await purge();
    expect(await left(B)).toEqual([40]);
    expect(r).toMatchObject({ band_locations_deleted: 1 });
  });
  it('a recent phone position makes an old band fix deletable, as before', async () => {
    await ping(A, 40, 'band_gps');
    await ping(A, 2);
    await purge();
    expect(await sources(A)).toEqual(['fg']);
  });
});

describe('step32k rules, unchanged by step32m', () => {
  it('older than 30 days are deleted; the last 30 days are kept', async () => {
    for (const d of [60, 31, 29, 1]) await ping(A, d);
    const r = await purge();
    expect(await left(A)).toEqual([29, 1]);
    expect(r).toMatchObject({ phone_location_days: 30, phone_locations_deleted: 2 });
  });
  it('an elder whose positions are all old keeps the newest one', async () => {
    for (const d of [90, 61, 45]) await ping(B, d);
    await purge();
    expect(await left(B)).toEqual([45]);
    await purge();
    expect(await left(B)).toEqual([45]);
  });
  it('each elder separately: one elder\'s new position never protects another\'s old ones', async () => {
    await ping(A, 40);
    await ping(A, 35);
    await ping(B, 1);
    await purge();
    expect(await left(A)).toEqual([35]);
    expect(await left(B)).toEqual([1]);
  });
  it('the setting changes the number of days', async () => {
    await db.exec(`update public.trend_config set value = 7 where key = 'phone_location_retention_days'`);
    for (const d of [10, 8, 6]) await ping(A, d);
    await purge();
    expect(await left(A)).toEqual([6]);
    await db.exec(`update public.trend_config set value = 30 where key = 'phone_location_retention_days'`);
  });
  it('band fixes and SOS locations keep their own rules; one audit row per run', async () => {
    await ping(A, 31, 'band_gps');
    await ping(A, 1);
    await db.exec(`insert into public.health_alerts (id, created_at) values ('00000000-0000-0000-0000-00000000a001', now() - interval '400 days'),
      ('00000000-0000-0000-0000-00000000a002', now() - interval '40 days');
      insert into public.alert_locations values ('00000000-0000-0000-0000-00000000a001', '${A}'), ('00000000-0000-0000-0000-00000000a002', '${A}')`);
    const r = await purge();
    expect(r).toMatchObject({ band_locations_deleted: 1, alert_locations_deleted: 1, phone_locations_deleted: 0 });
    expect((await db.query(`select 1 from public.alert_locations`)).rows).toHaveLength(1);
    expect((await db.query(`select 1 from public.audit_log where action = 'RETENTION_PURGE'`)).rows).toHaveLength(1);
  });
  it('the app cannot run it', async () => {
    const r = await db.query<{ ok: boolean }>(`select has_function_privilege('authenticated', 'public.location_purge()', 'execute') ok`);
    expect(r.rows[0].ok).toBe(false);
  });
});
