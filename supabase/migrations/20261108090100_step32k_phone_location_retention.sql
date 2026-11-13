-- step32k — the phone's shared positions are deleted after 30 days; each elder's latest
-- position is always kept (founder, 2026-11-08). Safe to apply twice. Needs step29b.
--
-- Since 2026-11-04 the elder's app shares its position every 5 minutes while it is
-- open (location_pings, source 'fg'), and nothing ever deleted those rows. The nightly
-- location_purge() (salem_location_retention, 00:45 UTC) now also deletes the phone's
-- positions (source fg / bg) older than trend_config.phone_location_retention_days
-- (30) — except each elder's newest position of any kind, so the caregiver's map
-- still shows "last seen" for an elder who hasn't opened the app in a month.
-- Everything else is unchanged: band fixes 30 days, SOS / fall locations
-- (alert_locations) 1 year. The audit row now also counts phone positions.

insert into public.trend_config (key, value, description) values
  ('phone_location_retention_days', 30,
   'The phone''s shared positions (location_pings, source fg / bg) are deleted after this many days; each elder''s latest position is always kept')
on conflict (key) do nothing;

create or replace function public.location_purge()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_band_days  int := public._band_cfg('band_location_retention_days', 30)::int;
  v_phone_days int := public._band_cfg('phone_location_retention_days', 30)::int;
  v_alert_days int := public._band_cfg('alert_location_retention_days', 365)::int;
  n_band  int;
  n_phone int;
  n_alert int;
  v_out jsonb;
begin
  delete from public.location_pings
   where source like 'band%' and captured_at < now() - make_interval(days => v_band_days);
  get diagnostics n_band = row_count;

  -- The phone's positions, never an elder's newest one.
  delete from public.location_pings p
   where p.source in ('fg', 'bg')
     and p.captured_at < now() - make_interval(days => v_phone_days)
     and exists (select 1 from public.location_pings n
                  where n.elder_id = p.elder_id
                    and (n.captured_at, n.id) > (p.captured_at, p.id));
  get diagnostics n_phone = row_count;

  delete from public.alert_locations l
   using public.health_alerts a
   where a.id = l.alert_id and a.created_at < now() - make_interval(days => v_alert_days);
  get diagnostics n_alert = row_count;

  v_out := jsonb_build_object('rule', 'location_retention',
                              'band_location_days', v_band_days, 'band_locations_deleted', n_band,
                              'phone_location_days', v_phone_days, 'phone_locations_deleted', n_phone,
                              'alert_location_days', v_alert_days, 'alert_locations_deleted', n_alert);
  insert into public.audit_log (actor_id, action, resource_type, resource_id, elder_id, payload)
  values (null, 'RETENTION_PURGE', 'location', null, null, v_out);
  return v_out;
end;
$$;

revoke all on function public.location_purge() from public, anon, authenticated;
grant execute on function public.location_purge() to service_role;

-- Check (read-only): how many phone positions are past 30 days, and how many the next
-- run will keep because they are an elder's latest.
-- select count(*) filter (where captured_at < now() - interval '30 days') as older_than_30d
--   from public.location_pings where source in ('fg', 'bg');
