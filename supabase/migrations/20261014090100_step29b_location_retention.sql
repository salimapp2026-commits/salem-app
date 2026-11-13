-- step29b — location retention + "Location update" wording.
--
-- 1. Nightly location_purge() (salem_location_retention, 00:45 UTC):
--      • location attached to an SOS / fall (alert_locations): deleted 1 year
--        after the alert. The alert itself is kept as before.
--      • detailed band locations: deleted after 30 days. Band fixes don't exist
--        yet (Salem Band v2 is planned, not built); when they arrive they will be
--        location_pings rows whose source starts with 'band', which this job
--        already covers. The phone's own pings (source fg / bg) are NOT touched —
--        their retention hasn't been decided.
--    Both numbers live in trend_config. One audit row per run.
-- 2. The follow-up push sent when the browser / phone returns a position after
--    an SOS is now titled "Location update" (add_sos_location).

insert into public.trend_config (key, value, description) values
  ('band_location_retention_days',  30, 'Detailed band locations (location_pings with a band source) are deleted after this many days'),
  ('alert_location_retention_days', 365, 'The location attached to an SOS / fall alert is deleted this many days after the alert')
on conflict (key) do nothing;

create or replace function public.location_purge()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_band_days  int := public._band_cfg('band_location_retention_days', 30)::int;
  v_alert_days int := public._band_cfg('alert_location_retention_days', 365)::int;
  n_band  int;
  n_alert int;
  v_out jsonb;
begin
  delete from public.location_pings
   where source like 'band%' and captured_at < now() - make_interval(days => v_band_days);
  get diagnostics n_band = row_count;

  delete from public.alert_locations l
   using public.health_alerts a
   where a.id = l.alert_id and a.created_at < now() - make_interval(days => v_alert_days);
  get diagnostics n_alert = row_count;

  v_out := jsonb_build_object('rule', 'location_retention',
                              'band_location_days', v_band_days, 'band_locations_deleted', n_band,
                              'alert_location_days', v_alert_days, 'alert_locations_deleted', n_alert);
  insert into public.audit_log (actor_id, action, resource_type, resource_id, elder_id, payload)
  values (null, 'RETENTION_PURGE', 'location', null, null, v_out);
  return v_out;
end;
$$;

revoke all on function public.location_purge() from public, anon, authenticated;
grant execute on function public.location_purge() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'salem_location_retention';
select cron.schedule('salem_location_retention', '45 0 * * *', $cron$ select public.location_purge(); $cron$);

-- "Location update" wording for the follow-up push (logic unchanged).
create or replace function public.add_sos_location(
  p_alert_id uuid,
  p_lat double precision,
  p_lon double precision,
  p_accuracy_m real default null
) returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  a public.health_alerts;
  v_name text;
  v_loc jsonb;
  v_what_en text;
  v_what_ar text;
begin
  select * into a from public.health_alerts where id = p_alert_id;
  if not found or a.elder_id is distinct from auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if a.kind not in ('sos', 'fall_detected') or a.created_at < now() - interval '15 minutes' then
    raise exception 'not_an_open_emergency' using errcode = '22023';
  end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'bad_position' using errcode = '22023';
  end if;

  insert into public.location_pings (elder_id, captured_at, geog, accuracy_m, source)
  values (a.elder_id, now(), st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography, p_accuracy_m, 'fg');

  insert into public.alert_locations (alert_id, elder_id, lat, lon, accuracy_m, captured_at, source)
  values (a.id, a.elder_id, p_lat, p_lon, p_accuracy_m, now(), 'sos_button')
  on conflict (alert_id) do update
    set lat = excluded.lat, lon = excluded.lon, accuracy_m = excluded.accuracy_m,
        captured_at = excluded.captured_at, source = excluded.source;

  select coalesce(nullif(split_part(trim(coalesce(display_name, '')), ' ', 1), ''), 'Your family member')
    into v_name from public.profiles where id = a.elder_id;
  v_loc := public._location_payload(a.elder_id, p_lat, p_lon, now());
  v_what_en := case when a.kind = 'sos' then 'SOS from ' else 'possible fall: ' end || v_name;
  v_what_ar := case when a.kind = 'sos' then 'استغاثة من ' else 'احتمال سقوط: ' end || v_name;

  perform public._post_edge('notify-fanout', jsonb_build_object(
    'elder_id', a.elder_id,
    'severity', 'critical',
    'source_kind', 'sos',
    'source_id', a.id,
    'title_ar', 'Location update: ' || v_what_en,
    'body_ar', 'Where ' || v_name || ' is now.',
    'texts', jsonb_build_object(
      'en', jsonb_build_object('title', 'Location update: ' || v_what_en, 'body', 'Where ' || v_name || ' is now.'),
      'ar', jsonb_build_object('title', 'تحديث الموقع: ' || v_what_ar, 'body', 'مكان ' || v_name || ' الآن.')),
    'location', v_loc,
    'location_recipients_only', true));
  return true;
end;
$$;

revoke all on function public.add_sos_location(uuid, double precision, double precision, real) from public, anon;
grant execute on function public.add_sos_location(uuid, double precision, double precision, real) to authenticated;
