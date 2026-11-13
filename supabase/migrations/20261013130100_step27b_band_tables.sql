-- step27b — Salem Band: tables, row-level security, triggers, thresholds.
--
-- See docs/BAND_PROTOCOL.md §8 for the rules these support.
--
-- What changes for EXISTING data and flows — nothing for manual readings:
--   • trg_maybe_emit_vital_alert and audit_vitals get a WHEN clause that skips
--     source = 'band' rows. Manual (and every other source) rows fire exactly
--     as before. Band rows get their own real-time check (step27c,
--     band_ingest) and one audit row per upload batch instead of one per row.
--   • Clients can no longer insert or edit rows with source = 'band' (only
--     band-ingest can, with the service role). Before this, the band source
--     didn't exist, so no current client is affected.
--   • refresh_vital_daily_summaries: low-quality band HR / SpO2 are left out,
--     and days older than the 90-day band retention are never recomputed
--     (their summaries are kept forever). Manual readings count as before.

-- ------------------------------------------------------------- vitals
alter table public.vitals add column if not exists quality smallint;
alter table public.vitals drop constraint if exists vitals_quality_range;
alter table public.vitals add constraint vitals_quality_range
  check (quality is null or quality between 0 and 100);

comment on column public.vitals.quality is
  'Band signal confidence 0–100 for heart rate / SpO2 (NULL = not applicable or manual). '
  'Readings below trend_config.band_quality_min are stored but excluded from alerts and Trend Watch.';
comment on column public.vitals.device_id is
  'Band serial number when source = ''band''.';

-- Duplicates are dropped on (band serial, type, time).
create unique index if not exists vitals_band_dedupe
  on public.vitals (device_id, kind, captured_at) where source = 'band';
-- Nightly 90-day purge.
create index if not exists vitals_band_captured_at
  on public.vitals (captured_at) where source = 'band';
-- Two-reading confirmation lookup.
create index if not exists vitals_band_elder_kind_time
  on public.vitals (elder_id, kind, captured_at desc) where source = 'band';

-- Only band-ingest (service role, bypasses RLS) may write band rows.
drop policy if exists vitals_no_client_band_insert on public.vitals;
create policy vitals_no_client_band_insert on public.vitals
  as restrictive for insert to authenticated, anon
  with check (source is distinct from 'band');

drop policy if exists vitals_no_client_band_update on public.vitals;
create policy vitals_no_client_band_update on public.vitals
  as restrictive for update to authenticated, anon
  using (source is distinct from 'band')
  with check (source is distinct from 'band');

-- Manual readings keep their per-row alert check and audit; band rows skip both.
drop trigger if exists trg_maybe_emit_vital_alert on public.vitals;
create trigger trg_maybe_emit_vital_alert
  after insert on public.vitals
  for each row when (new.source is distinct from 'band')
  execute function public.maybe_emit_vital_alert();

drop trigger if exists audit_vitals on public.vitals;
create trigger audit_vitals
  after insert or update on public.vitals
  for each row when (new.source is distinct from 'band')
  execute function public.tg_audit_write();

-- A DELETE trigger's WHEN can't see NEW, so deletes get their own trigger.
drop trigger if exists audit_vitals_delete on public.vitals;
create trigger audit_vitals_delete
  after delete on public.vitals
  for each row when (old.source is distinct from 'band')
  execute function public.tg_audit_write();

-- ------------------------------------------------------------- band_devices
create table if not exists public.band_devices (
  id                     uuid primary key default gen_random_uuid(),
  elder_id               uuid not null references public.profiles(id) on delete cascade,
  serial                 text not null check (serial ~ '^[A-Za-z0-9-]{4,32}$'),
  model                  text,
  firmware_version       text,
  battery_pct            smallint check (battery_pct between 0 and 100),
  is_charging            boolean not null default false,
  worn                   boolean,
  worn_changed_at        timestamptz,
  last_upload_at         timestamptz,
  last_record_at         timestamptz,
  paired_at              timestamptz not null default now(),
  forgotten_at           timestamptz,
  off_wrist_alerted_at   timestamptz,
  no_data_alerted_at     timestamptz,
  low_battery_alerted_at timestamptz
);

comment on table public.band_devices is
  'Salem Bands paired to an elder. One active band per elder; forgotten bands keep their row (forgotten_at).';

create unique index if not exists band_devices_one_active_per_elder
  on public.band_devices (elder_id) where forgotten_at is null;
create unique index if not exists band_devices_active_serial
  on public.band_devices (serial) where forgotten_at is null;

alter table public.band_devices enable row level security;
-- Read: the elder, and circle members with read-health. No location in here.
-- Writes only through register_band / forget_band / band_ingest (step27c).
drop policy if exists band_devices_read on public.band_devices;
create policy band_devices_read on public.band_devices
  for select to authenticated using (public.has_perm(elder_id, 'health'));

-- ------------------------------------------------------------- band_events
create table if not exists public.band_events (
  id           uuid primary key default gen_random_uuid(),
  elder_id     uuid not null references public.profiles(id) on delete cascade,
  band_id      uuid not null references public.band_devices(id) on delete cascade,
  kind         text not null check (kind in
                 ('sos','fall','off_wrist','on_wrist','low_battery','charging','fall_cancelled')),
  band_time    bigint not null,            -- raw u32 from the band (dedupe key)
  occurred_at  timestamptz,                -- NULL = band clock not set ("time unknown")
  received_at  timestamptz not null default now(),
  data         integer not null default 0,
  flags        smallint not null default 0,
  delayed      boolean not null default false,
  status       text not null default 'logged'
                 check (status in ('logged','pending','cancelled','alerted')),
  respond_by   timestamptz,                -- pending falls: "Are you OK?" deadline
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id) on delete set null,
  resolution   text check (resolution in ('band_button','elder_ok','elder_help','timeout','late')),
  alert_id     uuid references public.health_alerts(id) on delete set null,
  unique (band_id, kind, band_time)
);

comment on table public.band_events is
  'Events from the band (SOS, fall, off/on wrist, battery). Falls wait in status pending until "I''m OK" or the deadline.';

create index if not exists band_events_pending
  on public.band_events (respond_by) where status = 'pending';
create index if not exists band_events_elder_recent
  on public.band_events (elder_id, received_at desc);

alter table public.band_events enable row level security;
drop policy if exists band_events_read on public.band_events;
create policy band_events_read on public.band_events
  for select to authenticated using (public.has_perm(elder_id, 'health'));

-- ------------------------------------------------------------- thresholds
insert into public.trend_config (key, value, description) values
  ('band_quality_min',               60, 'Band HR / SpO2 below this quality are stored but excluded from alerts and Trend Watch'),
  ('band_realtime_max_age_minutes',  15, 'Band readings older than this skip the real-time check (stored for Trend Watch)'),
  ('band_future_tolerance_seconds', 120, 'A band time further ahead than this counts as old (clock wrong)'),
  ('band_confirm_window_minutes',    15, 'A critical band HR / SpO2 needs a second good resting reading past the threshold within this many minutes'),
  ('band_warning_repeat_minutes',    60, 'At most one band warning alert of the same kind per this many minutes'),
  ('band_fall_grace_seconds',        30, 'A fall waits this long for "I''m OK" before alerting'),
  ('band_offwrist_alert_hours',       2, 'Band off the wrist this long while awake → info alert'),
  ('band_no_data_hours',             12, 'No band data this long → info alert'),
  ('band_low_battery_repeat_hours',  12, 'At most one low-battery alert per this many hours'),
  ('band_awake_start_hour',           8, 'Off-wrist / no-data alerts only from this local hour'),
  ('band_awake_end_hour',            22, '… until this local hour'),
  ('band_raw_retention_days',        90, 'Raw band readings are deleted after this many days (daily summaries are kept)')
on conflict (key) do nothing;

-- ------------------------------------------------------------- daily summaries
-- Same as step26c, plus: low-quality band HR / SpO2 are excluded, and days
-- older than the band retention window are never recomputed (their raw band
-- rows are gone, so a recompute would lose the band part of the summary).
create or replace function public.refresh_vital_daily_summaries(p_elder uuid, p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz         text;
  v_band_min   int;
  v_manual_min int;
  v_act_min    int;
  v_night_min  int;
  v_ns         int;
  v_ne         int;
  v_shift      int;
  v_night_len  int;
  v_qmin       int;
  v_keep_days  int;
  v_rows       int;
begin
  select coalesce(nullif(timezone, ''), 'Africa/Cairo') into v_tz from public.profiles where id = p_elder;
  if v_tz is null then return 0; end if;

  select coalesce(max(value) filter (where key = 'min_readings_band'), 6)::int,
         coalesce(max(value) filter (where key = 'min_readings_manual'), 1)::int,
         coalesce(max(value) filter (where key = 'activity_min_blocks'), 60)::int,
         coalesce(max(value) filter (where key = 'night_min_blocks'), 36)::int,
         coalesce(max(value) filter (where key = 'night_start_hour'), 22)::int,
         coalesce(max(value) filter (where key = 'night_end_hour'), 6)::int,
         coalesce(max(value) filter (where key = 'band_quality_min'), 60)::int,
         coalesce(max(value) filter (where key = 'band_raw_retention_days'), 90)::int
    into v_band_min, v_manual_min, v_act_min, v_night_min, v_ns, v_ne, v_qmin, v_keep_days
    from public.trend_config;

  -- Never rebuild a day whose raw band data may already be purged.
  p_from := greatest(p_from, (now() at time zone v_tz)::date - (v_keep_days - 1));
  if p_from > p_to then return 0; end if;

  v_shift     := 24 - v_ns;
  v_night_len := v_ne + v_shift;

  delete from public.vital_daily_summaries
   where elder_id = p_elder and day between p_from and p_to;

  with v as (
    select kind, value_numeric, value_systolic, source, is_resting,
           (captured_at at time zone v_tz) as lt
      from public.vitals
     where elder_id = p_elder
       and captured_at >= ((p_from - 1)::timestamp at time zone v_tz)
       and captured_at <  ((p_to + 2)::timestamp at time zone v_tz)
       and not (source = 'band' and kind in ('heart_rate', 'spo2')
                and coalesce(quality, 0) < v_qmin)
  ),
  tagged as (
    select 'resting_hr'::text as metric, lt::date as day, value_numeric as x, source
      from v where kind = 'heart_rate' and value_numeric is not null and coalesce(is_resting, true)
    union all
    select 'spo2', lt::date, value_numeric, source
      from v where kind = 'spo2' and value_numeric is not null and coalesce(is_resting, true)
    union all
    select 'skin_temp', lt::date, value_numeric, source
      from v where kind = 'skin_temperature' and value_numeric is not null
    union all
    select 'activity', lt::date, value_numeric, source
      from v where kind = 'steps' and value_numeric is not null
    union all
    select 'night_restlessness', (lt + make_interval(hours => v_shift))::date, value_numeric, source
      from v where kind = 'movement' and value_numeric is not null
       and extract(hour from (lt + make_interval(hours => v_shift))) < v_night_len
    union all
    select 'bp_systolic', lt::date, value_systolic::numeric, source
      from v where kind = 'blood_pressure' and value_systolic is not null
    union all
    select 'glucose', lt::date, value_numeric, source
      from v where kind = 'glucose' and value_numeric is not null
  ),
  agg as (
    select metric, day,
           percentile_cont(0.5) within group (order by x) as med,
           avg(x) as mean, min(x) as mn, max(x) as mx, sum(x) as tot, count(*) as n,
           bool_or(source <> 'manual') as band
      from tagged
     where day between p_from and p_to
     group by metric, day
  )
  insert into public.vital_daily_summaries
    (elder_id, metric, day, value, median, mean, min, max, total, n, from_band, enough)
  select p_elder, metric, day,
         case metric
           when 'resting_hr' then med
           when 'spo2' then med
           when 'activity' then tot
           when 'night_restlessness' then tot
           else mean
         end,
         med, mean, mn, mx, tot, n, band,
         case
           when metric = 'activity' and band then n >= v_act_min
           when metric = 'night_restlessness' then n >= v_night_min
           when band then n >= v_band_min
           else n >= v_manual_min
         end
    from agg;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.refresh_vital_daily_summaries(uuid, date, date) from public, anon, authenticated;
grant execute on function public.refresh_vital_daily_summaries(uuid, date, date) to service_role;
