-- step30d — Rafiq ML: database functions.
--
--   rafiq_raise()             record a Rafiq finding and decide whether to push it
--                             (the ONE place the rate limit lives)
--   acknowledge_rafiq_alert() a caregiver / doctor / the elder marks it seen
--   rafiq_resolve()           the scorer closes an alert after normal days
--   rafiq_elders_due()        who the daily pass scores
--   rafiq_tick()              decides when a pass runs (daily ~07:00 Cairo;
--                             hourly only if rafiq_config says so)
--   rafiq_retention()         deletes old hourly scores
--
-- rafiq_tick() is NOT scheduled here: the cron entry comes in a later migration,
-- applied after the rafiq-score edge function is deployed, so a tick can never
-- call a function that doesn't exist (same order as Trend Watch, step26d).
--
-- Routing (founder, 2026-10-22): watch → in-app only; alert and urgent → push
-- to caregivers with read-health and linked doctors (get_trend_recipients).
-- Nothing here ever carries a location.

create or replace function public._rafiq_cfg(p_key text, p_default numeric)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce((select value from public.rafiq_config where key = p_key), p_default);
$$;

-- ------------------------------------------------------------------ raise
-- Called by rafiq-score once per (elder, reason) per pass. Creates the live
-- alert for that reason, or updates it (level, days, text). Pushes when:
--   • urgent: always, except an identical urgent pushed in the last 30 minutes
--     (a retried run must not double-push). Urgent bypasses every other limit.
--   • watch / alert: the reason is new, or escalated, or wasn't pushed within
--     notify_cooldown_hours (72 h, as Trend Watch) — AND the elder got fewer than
--     max_notifications_per_day Rafiq pushes (watch / alert) in the last 24 h.
-- Alert and urgent also get a health_alerts row (kind 'rafiq', no_fanout) so
-- they appear in the alert lists; its payload has no numbers or location
-- (health_alerts is readable by the whole circle), the details stay in the
-- read-health-protected rafiq_alerts.
create or replace function public.rafiq_raise(
  p_elder       uuid,
  p_level       public.rafiq_level,
  p_reason_code text,
  p_metrics     text[],
  p_params      jsonb,
  p_reason_en   text,
  p_reason_ar   text,
  p_title_en    text,
  p_title_ar    text,
  p_scored_for  date,
  p_score_id    uuid default null,
  p_days        integer default 1,
  p_now         timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a            public.rafiq_alerts;
  v_new        boolean := false;
  v_escalated  boolean := false;
  v_notify     boolean := false;
  v_why        text;
  v_cooldown   interval := make_interval(hours => public._rafiq_cfg('notify_cooldown_hours', 72)::int);
  v_max_day    int := public._rafiq_cfg('max_notifications_per_day', 2)::int;
  v_sent_24h   int;
  v_health_id  uuid;
  v_severity   public.alert_severity;
begin
  if p_level is null or p_level = 'normal' then
    raise exception 'rafiq_raise needs watch, alert or urgent' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason_en), '') = '' or coalesce(trim(p_reason_ar), '') = '' then
    raise exception 'rafiq_raise needs the reason in English and Arabic' using errcode = '22023';
  end if;

  select * into a from public.rafiq_alerts
   where elder_id = p_elder and reason_code = p_reason_code and status in ('open', 'acknowledged')
   for update;

  if not found then
    insert into public.rafiq_alerts
      (elder_id, level, reason_code, metrics, reason_params, reason_en, reason_ar,
       score_id, opened_for, opened_at, days, updated_at)
    values
      (p_elder, p_level, p_reason_code, coalesce(p_metrics, '{}'), coalesce(p_params, '{}'),
       p_reason_en, p_reason_ar, p_score_id, p_scored_for, p_now, greatest(coalesce(p_days, 1), 1), p_now)
    returning * into a;
    v_new := true;
  else
    v_escalated := p_level > a.level;
    update public.rafiq_alerts
       set level = p_level,
           metrics = coalesce(p_metrics, metrics),
           reason_params = coalesce(p_params, reason_params),
           reason_en = p_reason_en,
           reason_ar = p_reason_ar,
           score_id = coalesce(p_score_id, score_id),
           days = greatest(coalesce(p_days, days), 1),
           -- Seen at a lower level, now worse: it needs to be seen again.
           status = case when v_escalated then 'open' else status end,
           acknowledged_by = case when v_escalated then null else acknowledged_by end,
           acknowledged_at = case when v_escalated then null else acknowledged_at end,
           updated_at = p_now
     where id = a.id
     returning * into a;
  end if;

  if p_level = 'urgent' then
    v_notify := v_new or v_escalated or a.last_notified_at is null
                or a.last_notified_at < p_now - interval '30 minutes';
    v_why := case when v_notify then 'urgent' else 'urgent_already_sent' end;
  else
    select count(*) into v_sent_24h
      from public.rafiq_alerts r
     where r.elder_id = p_elder and r.id <> a.id
       and r.level in ('watch', 'alert')
       and r.last_notified_at > p_now - interval '24 hours';
    if not (v_new or v_escalated or a.last_notified_at is null or a.last_notified_at < p_now - v_cooldown) then
      v_why := 'cooldown';
    elsif v_sent_24h >= v_max_day then
      v_why := 'daily_limit';
    else
      v_notify := true;
      v_why := case when v_new then 'new' when v_escalated then 'escalated' else 'reminder' end;
    end if;
  end if;

  if v_notify then
    v_severity := case p_level when 'urgent' then 'critical'::public.alert_severity
                               else 'warning'::public.alert_severity end;

    if p_level in ('alert', 'urgent') then
      insert into public.health_alerts (elder_id, kind, severity, payload, created_at)
      values (p_elder, 'rafiq', v_severity, jsonb_build_object(
                'no_fanout', true, 'source', 'rafiq', 'rafiq_alert_id', a.id,
                'level', p_level, 'reason_code', p_reason_code, 'metrics', to_jsonb(coalesce(p_metrics, '{}'))),
              p_now)
      returning id into v_health_id;
    end if;

    update public.rafiq_alerts
       set last_notified_at = p_now,
           notify_count = notify_count + 1,
           alert_id = coalesce(v_health_id, alert_id)
     where id = a.id;

    -- The push itself. A failure here never undoes the alert.
    begin
      perform public._post_edge('notify-fanout', jsonb_build_object(
        'elder_id', p_elder,
        'severity', v_severity,
        'source_kind', 'rafiq',
        'source_id', a.id,
        'title_ar', p_title_en,
        'body_ar', p_reason_en,
        'texts', jsonb_build_object(
          'en', jsonb_build_object('title', p_title_en, 'body', p_reason_en),
          'ar', jsonb_build_object('title', p_title_ar, 'body', p_reason_ar)),
        'recipients', 'trend',          -- caregivers with read-health + linked doctors
        'in_app_only', p_level = 'watch'));
    exception when others then
      raise warning 'salem: rafiq push failed for rafiq_alert %: %', a.id, sqlerrm;
      v_why := v_why || '+push_failed';
    end;
  end if;

  return jsonb_build_object(
    'rafiq_alert_id', a.id,
    'health_alert_id', v_health_id,
    'new', v_new,
    'escalated', v_escalated,
    'notified', v_notify,
    'in_app_only', v_notify and p_level = 'watch',
    'why', v_why);
end;
$$;

-- ------------------------------------------------------------------ resolve
create or replace function public.rafiq_resolve(p_rafiq_alert uuid, p_now timestamptz default now())
returns void
language sql
security definer
set search_path = public
as $$
  update public.rafiq_alerts
     set status = 'resolved', resolved_at = p_now, updated_at = p_now
   where id = p_rafiq_alert and status in ('open', 'acknowledged');
$$;

-- ------------------------------------------------------------------ acknowledge
-- The elder, or a member who may read their health, marks a Rafiq alert as seen.
create or replace function public.acknowledge_rafiq_alert(p_rafiq_alert uuid)
returns public.rafiq_alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.rafiq_alerts;
begin
  select * into a from public.rafiq_alerts where id = p_rafiq_alert;
  if not found or not public.has_perm(a.elder_id, 'health') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.rafiq_alerts
     set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now(), updated_at = now()
   where id = a.id and status = 'open'
   returning * into a;
  if not found then
    select * into a from public.rafiq_alerts where id = p_rafiq_alert;
  end if;
  return a;
end;
$$;

-- ------------------------------------------------------------------ who to score
create or replace function public.rafiq_elders_due(p_lookback_days int default 40)
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

-- ------------------------------------------------------------------ housekeeping
create or replace function public.rafiq_retention()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from public.rafiq_scores
   where scope = 'intraday'
     and created_at < now() - make_interval(days => public._rafiq_cfg('intraday_retention_days', 90)::int);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ------------------------------------------------------------------ tick
-- Meant to run every hour (cron added later). Starts:
--   • the daily pass once a day at daily_run_hour_cairo (07:00 by default): it
--     scores YESTERDAY plus the night that ended this morning, so overnight
--     SpO2 / resting-HR patterns are included;
--   • an hourly "today so far" pass, only when scoring_hourly_enabled = 1.
-- rafiq_runs makes it idempotent: a second tick in the same hour does nothing.
-- p_now exists for tests.
create or replace function public.rafiq_tick(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local  timestamp := p_now at time zone 'Africa/Cairo';
  v_date   date := (p_now at time zone 'Africa/Cairo')::date;
  v_hour   int := extract(hour from (p_now at time zone 'Africa/Cairo'))::int;
  v_rows   int;
  v_posted int := 0;
begin
  if public._rafiq_cfg('scoring_daily_enabled', 1) = 1
     and v_hour = public._rafiq_cfg('daily_run_hour_cairo', 7)::int then
    insert into public.rafiq_runs (run_kind, local_date, local_hour)
    values ('daily', v_date, 0)
    on conflict (run_kind, local_date, local_hour) where run_kind <> 'replay' do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      perform public.rafiq_retention();
      perform public._post_edge('rafiq-score', jsonb_build_object(
        'mode', 'daily', 'scored_for', v_date - 1, 'run_date', v_date,
        'weekly', extract(dow from v_local) = 0));
      v_posted := v_posted + 1;
    end if;
    return v_posted;   -- the daily pass covers this hour too
  end if;

  if public._rafiq_cfg('scoring_hourly_enabled', 0) = 1 then
    insert into public.rafiq_runs (run_kind, local_date, local_hour)
    values ('hourly', v_date, v_hour)
    on conflict (run_kind, local_date, local_hour) where run_kind <> 'replay' do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      perform public._post_edge('rafiq-score', jsonb_build_object(
        'mode', 'intraday', 'scored_for', v_date, 'run_date', v_date, 'hour', v_hour));
      v_posted := v_posted + 1;
    end if;
  end if;
  return v_posted;
end;
$$;

-- ------------------------------------------------------------------ grants
revoke all on function public._rafiq_cfg(text, numeric) from public, anon, authenticated;
revoke all on function public.rafiq_raise(uuid, public.rafiq_level, text, text[], jsonb, text, text, text, text, date, uuid, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.rafiq_resolve(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.rafiq_elders_due(int) from public, anon, authenticated;
revoke all on function public.rafiq_retention() from public, anon, authenticated;
revoke all on function public.rafiq_tick(timestamptz) from public, anon, authenticated;
revoke all on function public.acknowledge_rafiq_alert(uuid) from public, anon;

grant execute on function public._rafiq_cfg(text, numeric) to service_role;
grant execute on function public.rafiq_raise(uuid, public.rafiq_level, text, text[], jsonb, text, text, text, text, date, uuid, integer, timestamptz)
  to service_role;
grant execute on function public.rafiq_resolve(uuid, timestamptz) to service_role;
grant execute on function public.rafiq_elders_due(int) to service_role;
grant execute on function public.rafiq_retention() to service_role;
grant execute on function public.rafiq_tick(timestamptz) to service_role;
grant execute on function public.acknowledge_rafiq_alert(uuid) to authenticated, service_role;
