-- step26c — Trend Watch database functions.
--
--   refresh_vital_daily_summaries  nightly per-elder daily aggregates (service only)
--   trend_elders_due               which elders the nightly pass should look at (service only)
--   get_trend_recipients           info → primary caretaker; warning → caretaker + family + doctor
--                                  (separate from get_alert_recipients, which is unchanged)
--   has_feature                    plan gate; returns true for now (payments not built)
--   mark_trend_expected            doctors only; pauses the metric 14 days, restarts its
--                                  baseline, resolves the linked alert, writes audit_log
--   trend_watch_tick               hourly cron entry; fires the edge function at 06:00 Cairo
--
-- Every SECURITY DEFINER function pins search_path and has EXECUTE revoked from
-- anon / authenticated unless the app genuinely needs to call it.

-- ------------------------------------------------- daily summaries (nightly)
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
  v_rows       int;
begin
  select coalesce(nullif(timezone, ''), 'Africa/Cairo') into v_tz from public.profiles where id = p_elder;
  if v_tz is null then return 0; end if;

  select coalesce(max(value) filter (where key = 'min_readings_band'), 6)::int,
         coalesce(max(value) filter (where key = 'min_readings_manual'), 1)::int,
         coalesce(max(value) filter (where key = 'activity_min_blocks'), 60)::int,
         coalesce(max(value) filter (where key = 'night_min_blocks'), 36)::int,
         coalesce(max(value) filter (where key = 'night_start_hour'), 22)::int,
         coalesce(max(value) filter (where key = 'night_end_hour'), 6)::int
    into v_band_min, v_manual_min, v_act_min, v_night_min, v_ns, v_ne
    from public.trend_config;

  -- Shift the clock so the night window (e.g. 22:00–06:00) lands inside one
  -- calendar day: the night is filed under the morning it ends on.
  v_shift     := 24 - v_ns;          -- 22:00 → +2 h
  v_night_len := v_ne + v_shift;     -- 06:00 + 2 h → the first 8 shifted hours

  delete from public.vital_daily_summaries
   where elder_id = p_elder and day between p_from and p_to;

  with v as (
    select kind, value_numeric, value_systolic, source, is_resting,
           (captured_at at time zone v_tz) as lt
      from public.vitals
     where elder_id = p_elder
       and captured_at >= ((p_from - 1)::timestamp at time zone v_tz)
       and captured_at <  ((p_to + 2)::timestamp at time zone v_tz)
  ),
  tagged as (
    -- Heart rate and SpO2: resting readings only when the band says so;
    -- manual readings (is_resting NULL) always count.
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
         -- the one number the rules compare, per metric
         case metric
           when 'resting_hr' then med
           when 'spo2' then med
           when 'activity' then tot
           when 'night_restlessness' then tot
           else mean                                  -- skin_temp, bp_systolic, glucose
         end,
         med, mean, mn, mx, tot, n, band,
         case
           when metric = 'activity' and band then n >= v_act_min
           when metric = 'night_restlessness' then n >= v_night_min
           when band then n >= v_band_min
           else n >= v_manual_min                    -- manual: 1 reading a day is enough
         end
    from agg;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- --------------------------------------------------------- elders to process
create or replace function public.trend_elders_due(p_lookback_days int default 40)
returns table (elder_id uuid, display_name text, timezone text, locale text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, coalesce(nullif(p.timezone, ''), 'Africa/Cairo'), p.preferred_locale
    from public.profiles p
   where p.role = 'elder'
     and exists (
       select 1 from public.vitals v
        where v.elder_id = p.id
          and v.captured_at >= now() - make_interval(days => p_lookback_days)
     );
$$;

-- --------------------------------------------------------------- recipients
create or replace function public.get_trend_recipients(p_elder_id uuid, p_severity public.alert_severity)
returns table (user_id uuid, member_role public.circle_member_role, locale text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, m.member_role, coalesce(p.preferred_locale, 'en') as locale
    from public.care_circle_members m
    join public.care_circles c on c.id = m.circle_id
    join public.profiles p on p.id = m.user_id
   where c.elder_id = p_elder_id
     and m.status = 'active'
     and m.can_read_health = true
     and (
       (p_severity = 'info' and m.member_role = 'primary_caretaker')
       -- Trend Watch never sends critical; treat anything above info as warning.
       or (p_severity <> 'info' and m.member_role in ('primary_caretaker', 'family', 'doctor'))
     );
$$;

-- -------------------------------------------------------------- plan gate
-- Payments aren't built yet, so every known feature is on. When they are,
-- this is the single place that changes. SOS and critical alerts never call
-- this — they are free on every plan.
create or replace function public.has_feature(p_elder_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_feature in ('trend_watch', 'band_history');
$$;

-- -------------------------------------------------------- mark as expected
create or replace function public.mark_trend_expected(p_finding_id uuid, p_reason text)
returns public.trend_findings
language plpgsql
security definer
set search_path = public
as $$
declare
  f        public.trend_findings;
  v_tz     text;
  v_today  date;
  v_pause  int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required';
  end if;

  select * into f from public.trend_findings where id = p_finding_id for update;
  if not found then
    raise exception 'finding_not_found';
  end if;

  -- Doctors only. Caregivers can see findings but cannot dismiss them.
  if not exists (
    select 1
      from public.care_circle_members m
      join public.care_circles c on c.id = m.circle_id
     where c.elder_id = f.elder_id
       and m.user_id = auth.uid()
       and m.status = 'active'
       and m.member_role = 'doctor'
       and m.can_read_health
  ) then
    raise exception 'only_doctors_can_mark_expected' using errcode = '42501';
  end if;

  if f.status <> 'open' then
    raise exception 'finding_not_open';
  end if;

  select coalesce(nullif(timezone, ''), 'Africa/Cairo') into v_tz from public.profiles where id = f.elder_id;
  v_today := (now() at time zone v_tz)::date;
  select coalesce(max(value), 14)::int into v_pause from public.trend_config where key = 'expected_pause_days';

  update public.trend_findings
     set status = 'marked_expected',
         expected_by = auth.uid(),
         expected_reason = left(btrim(p_reason), 500),
         expected_at = now(),
         updated_at = now()
   where id = f.id
  returning * into f;

  -- Pause this metric and restart its baseline from today.
  insert into public.trend_baselines (elder_id, metric, reset_at, paused_until, learning, learning_day)
  values (f.elder_id, f.metric, v_today, v_today + v_pause, true, 0)
  on conflict (elder_id, metric) do update
     set reset_at = excluded.reset_at,
         paused_until = excluded.paused_until,
         learning = true,
         learning_day = 0,
         updated_at = now();

  if f.alert_id is not null then
    update public.health_alerts set resolved_at = coalesce(resolved_at, now()) where id = f.alert_id;
  end if;

  insert into public.audit_log (actor_id, action, resource_type, resource_id, elder_id, payload)
  values (auth.uid(), 'trend_marked_expected', 'trend_findings', f.id::text, f.elder_id,
          jsonb_build_object('metric', f.metric, 'reason', f.expected_reason,
                             'paused_until', v_today + v_pause, 'baseline_reset_at', v_today));
  return f;
end;
$$;

-- ------------------------------------------------------------- hourly tick
-- pg_cron runs in UTC and Egypt observes daylight saving, so the job runs
-- hourly and only acts when it is 06:00 in Cairo. trend_runs makes it
-- idempotent: a second tick in the same hour does nothing.
create or replace function public.trend_watch_tick()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamp := now() at time zone 'Africa/Cairo';
  v_date   date := (now() at time zone 'Africa/Cairo')::date;
  v_weekly boolean := extract(dow from (now() at time zone 'Africa/Cairo')) = 0;  -- Sunday
  v_rows   int;
begin
  if extract(hour from v_now) <> 6 then
    return null;
  end if;

  insert into public.trend_runs (run_kind, local_date)
  values ('daily', v_date)
  on conflict (run_kind, local_date) where run_kind <> 'replay' do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return null;   -- already ran today
  end if;

  if v_weekly then
    insert into public.trend_runs (run_kind, local_date)
    values ('weekly', v_date)
    on conflict (run_kind, local_date) where run_kind <> 'replay' do nothing;
  end if;

  return public._post_edge('trend-watch',
    jsonb_build_object('mode', 'daily', 'weekly', v_weekly, 'run_date', v_date));
end;
$$;

-- ----------------------------------------------------------------- grants
revoke all on function public.refresh_vital_daily_summaries(uuid, date, date) from public, anon, authenticated;
revoke all on function public.trend_elders_due(int)                           from public, anon, authenticated;
revoke all on function public.get_trend_recipients(uuid, public.alert_severity) from public, anon, authenticated;
revoke all on function public.trend_watch_tick()                              from public, anon, authenticated;
revoke all on function public.has_feature(uuid, text)                         from public, anon;
revoke all on function public.mark_trend_expected(uuid, text)                 from public, anon;

grant execute on function public.refresh_vital_daily_summaries(uuid, date, date)  to service_role;
grant execute on function public.trend_elders_due(int)                            to service_role;
grant execute on function public.get_trend_recipients(uuid, public.alert_severity) to service_role;
grant execute on function public.trend_watch_tick()                               to service_role;
grant execute on function public.has_feature(uuid, text)                          to authenticated, service_role;
grant execute on function public.mark_trend_expected(uuid, text)                  to authenticated;
