-- step32m — the nightly location clean-up never deletes an elder's newest position, of
-- any source (founder, 2026-11-08). Safe to apply twice. Needs step32k.
--
-- step32k kept a phone position only while no newer ping of any source existed, but
-- band fixes were still deleted after 30 days with no such check. So an elder whose
-- newest ping came from the band could lose their last phone position first, then the
-- band ping a month later — and the map would have nothing. Now both rules (band
-- fixes after band_location_retention_days, phone positions after
-- phone_location_retention_days) skip each elder's single newest ping, whatever its
-- source. SOS / fall locations (alert_locations, 1 year) are unchanged.

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
  -- Band fixes, never an elder's newest position of any source.
  delete from public.location_pings p
   where p.source like 'band%'
     and p.captured_at < now() - make_interval(days => v_band_days)
     and exists (select 1 from public.location_pings n
                  where n.elder_id = p.elder_id
                    and (n.captured_at, n.id) > (p.captured_at, p.id));
  get diagnostics n_band = row_count;

  -- The phone's positions, the same way.
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
