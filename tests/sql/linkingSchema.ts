// The live shapes the family-linking migrations touch (step32b, step32d), shared by
// their tests. Read from salem-prod on 2026-11-01.
export const LINKING_LIVE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;

create type public.app_role as enum ('elder','family','caretaker','doctor','admin');
create type public.circle_member_role as enum ('primary_caretaker','family','doctor');
create type public.circle_member_status as enum ('pending','active','removed');
create table public.profiles (id uuid primary key, role public.app_role, display_name text);
create table public.care_circles (id uuid primary key default gen_random_uuid(), elder_id uuid not null unique, display_name text);
create table public.care_circle_members (
  id uuid primary key default gen_random_uuid(), circle_id uuid not null, user_id uuid not null,
  member_role public.circle_member_role not null,
  can_read_health boolean not null default true, can_read_location boolean not null default false,
  can_chat boolean not null default true, can_call boolean not null default true,
  can_manage_circle boolean not null default false,
  status public.circle_member_status not null default 'pending', invited_by uuid,
  created_at timestamptz not null default now(), relationship text,
  constraint care_circle_members_circle_id_user_id_key unique (circle_id, user_id));
create table public.care_circle_invites (
  id uuid primary key default gen_random_uuid(), circle_id uuid, invited_by uuid, email text, phone_e164 text,
  member_role public.circle_member_role, token text unique default md5(random()::text || clock_timestamp()::text),
  expires_at timestamptz default now() + interval '7 days', accepted_at timestamptz,
  created_at timestamptz not null default now(), for_new_elder boolean default false, elder_display_name text,
  pair_code text, pair_code_expires_at timestamptz);
create unique index care_circle_invites_live_pair_code on public.care_circle_invites (pair_code)
  where pair_code is not null and accepted_at is null;
create table public.pairing_attempts (id uuid primary key default gen_random_uuid(), user_id uuid,
  attempted_at timestamptz default now(), succeeded boolean default false);
create function public.create_pairing_code(p_member_role public.circle_member_role default 'family')
  returns table(code text, expires_at timestamptz) language sql as $$ select '0000'::text, now() $$;
create function public.redeem_pairing_code(p_code text)
  returns table(r_circle_id uuid) language sql as $$ select null::uuid $$;
`;
