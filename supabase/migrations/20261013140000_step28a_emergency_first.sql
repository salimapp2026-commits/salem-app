-- step28a — emergencies are pushed first, the AI comes after; emergency
-- location is protected.
--
-- 1. SOS / fall alerts (any source) are pushed IMMEDIATELY with fixed text to
--    everyone the critical rule names (get_alert_recipients 'critical').
--    tg_health_alert_fanout then calls analyze-vitals with already_notified,
--    which delivers its assessment as an in-app update only. Both calls are
--    wrapped so a failure can never undo or delay the alert; an AI that is
--    down or slow changes nothing for the family (pg_net requests are
--    independent and asynchronous).
--    Non-emergency alerts: unchanged, except the analyze-vitals call is now
--    wrapped too, so a pg_net error can't roll back the alert row.
--
-- 2. "Last known location" for emergencies lives in alert_locations, readable
--    by the elder and by members with the location permission — never doctors
--    (can_read_location returns false for them) — and on EVERY plan: there is
--    deliberately no plan / has_feature check here. Live tracking may be paid;
--    the location of an emergency is not.
--    The push carries it only for those recipients (notify-fanout v5). It is
--    never written into health_alerts.payload or notification_log, which
--    doctors can read.
--
-- 3. raise_sos no longer stores lat/lon in the payload (doctors could read
--    it). A position sent with the SOS by the elder's own device becomes their
--    last known location. add_sos_location() attaches a position that arrives
--    a few seconds after the SOS (the SOS is never held back waiting for GPS)
--    and sends a location follow-up to the allowed recipients only.
--
-- 4. elder_live_location now uses can_read_location, so a doctor is refused
--    even if their location flag were ever set.
--
-- 5. Existing data: the one SOS row that had lat/lon in its payload is moved
--    into alert_locations and the coordinates are removed from the payload.

-- ------------------------------------------------------------------ table
create table if not exists public.alert_locations (
  alert_id    uuid primary key references public.health_alerts(id) on delete cascade,
  elder_id    uuid not null references public.profiles(id) on delete cascade,
  lat         double precision not null check (lat between -90 and 90),
  lon         double precision not null check (lon between -180 and 180),
  accuracy_m  real,
  captured_at timestamptz not null,
  source      text not null check (source in ('sos_button', 'last_ping', 'migrated_payload')),
  created_at  timestamptz not null default now()
);

comment on table public.alert_locations is
  'Last known location attached to an SOS / fall alert. Visible to the elder and to members with the '
  'location permission, never doctors, on every plan (no plan check by design).';

alter table public.alert_locations enable row level security;
drop policy if exists alert_locations_read on public.alert_locations;
create policy alert_locations_read on public.alert_locations
  for select to authenticated
  using (elder_id = auth.uid() or public.can_read_location(elder_id));
-- No insert/update/delete policies: written only by the functions below.

-- ------------------------------------------------------------------ helpers
create or replace function public._last_known_location(p_elder uuid)
returns table (lat double precision, lon double precision, accuracy_m real, captured_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select st_y(lp.geog::geometry), st_x(lp.geog::geometry), lp.accuracy_m, lp.captured_at
    from public.location_pings lp
   where lp.elder_id = p_elder
   order by lp.captured_at desc
   limit 1;
$$;

-- {url, text_en, text_ar} for notify-fanout. Time in the elder's timezone;
-- the date is added when the fix is more than a day old.
create or replace function public._location_payload(p_elder uuid, p_lat double precision, p_lon double precision, p_at timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_tz  text;
  v_url text := 'https://maps.google.com/?q=' || to_char(p_lat, 'FM990.00000') || ',' || to_char(p_lon, 'FM9990.00000');
  v_when text;
begin
  select coalesce(nullif(timezone, ''), 'Africa/Cairo') into v_tz from public.profiles where id = p_elder;
  v_when := to_char(p_at at time zone coalesce(v_tz, 'Africa/Cairo'),
                    case when p_at < now() - interval '1 day' then 'DD Mon HH24:MI' else 'HH24:MI' end);
  return jsonb_build_object(
    'url', v_url,
    'text_en', 'Last known location (' || v_when || '): ' || v_url,
    'text_ar', 'آخر موقع معروف (' || v_when || '): ' || v_url);
end;
$$;

-- Attach the elder's last known location to an alert; returns the push payload
-- or NULL when no location is known.
create or replace function public._emergency_location(p_alert uuid, p_elder uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  l record;
begin
  select * into l from public.alert_locations where alert_id = p_alert;
  if found then
    return public._location_payload(p_elder, l.lat, l.lon, l.captured_at);
  end if;
  select * into l from public._last_known_location(p_elder);
  if not found or l.lat is null then return null; end if;
  insert into public.alert_locations (alert_id, elder_id, lat, lon, accuracy_m, captured_at, source)
  values (p_alert, p_elder, l.lat, l.lon, l.accuracy_m, l.captured_at, 'last_ping')
  on conflict (alert_id) do nothing;
  return public._location_payload(p_elder, l.lat, l.lon, l.captured_at);
end;
$$;

-- The immediate, fixed-text push for an SOS / fall that did NOT come from the
-- band (band alerts push themselves via _band_raise).
create or replace function public._notify_emergency_first(p_alert public.health_alerts)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_name   text;
  v_raiser text;
  v_loc    jsonb;
  v_t_en text; v_b_en text; v_t_ar text; v_b_ar text;
  v_by uuid := nullif(p_alert.payload->>'raised_by', '')::uuid;
begin
  select coalesce(nullif(split_part(trim(coalesce(display_name, '')), ' ', 1), ''), 'Your family member')
    into v_name from public.profiles where id = p_alert.elder_id;
  if v_by is not null and v_by <> p_alert.elder_id then
    select coalesce(nullif(split_part(trim(coalesce(display_name, '')), ' ', 1), ''), 'A family member')
      into v_raiser from public.profiles where id = v_by;
  end if;

  if p_alert.kind = 'sos' then
    v_t_en := 'SOS from ' || v_name;
    v_t_ar := 'استغاثة من ' || v_name;
    if v_raiser is not null then
      v_b_en := v_raiser || ' raised an SOS for ' || v_name || ' in the Salem app. Call them now.';
      v_b_ar := v_raiser || ' أطلق نداء استغاثة لـ' || v_name || ' من تطبيق سليم. اتصل الآن.';
    else
      v_b_en := v_name || ' pressed the SOS button in the Salem app. Call them now.';
      v_b_ar := 'تم الضغط على زر الاستغاثة في تطبيق سليم. اتصل الآن.';
    end if;
  else
    v_t_en := 'Possible fall: ' || v_name;
    v_t_ar := 'احتمال سقوط: ' || v_name;
    v_b_en := 'Salem detected a possible fall. Call them now.';
    v_b_ar := 'رصد سليم احتمال سقوط. اتصل الآن.';
  end if;

  v_loc := public._emergency_location(p_alert.id, p_alert.elder_id);

  perform public._post_edge('notify-fanout', jsonb_build_object(
    'elder_id', p_alert.elder_id,
    'severity', 'critical',
    'source_kind', case when p_alert.kind = 'sos' then 'sos' else 'health_alert' end,
    'source_id', p_alert.id,
    'title_ar', v_t_en,
    'body_ar', v_b_en,
    'texts', jsonb_build_object(
      'en', jsonb_build_object('title', v_t_en, 'body', v_b_en),
      'ar', jsonb_build_object('title', v_t_ar, 'body', v_b_ar)),
    'location', v_loc));
end;
$$;

-- ------------------------------------------------------------------ fan-out trigger
create or replace function public.tg_health_alert_fanout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emergency boolean := NEW.kind in ('sos', 'fall_detected') and NEW.severity = 'critical';
begin
  -- Alerts that push themselves (band, Trend Watch) carry no_fanout.
  if (NEW.payload ? 'no_fanout') then
    return NEW;
  end if;

  -- 1. Emergencies: tell the family now, with fixed text. Never waits for AI.
  if v_emergency then
    begin
      perform public._notify_emergency_first(NEW);
    exception when others then
      raise warning 'salem: emergency push failed for alert %: %', NEW.id, sqlerrm;
    end;
  end if;

  -- 2. The AI assessment, afterwards. A failure here can't touch the alert.
  begin
    perform public._post_edge(
      'analyze-vitals',
      jsonb_build_object(
        'elder_id', NEW.elder_id,
        'alert_id', NEW.id,
        'source', 'health_alert_trigger',
        'already_notified', v_emergency
      )
    );
  exception when others then
    raise warning 'salem: analyze-vitals call failed for alert %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$$;

-- ------------------------------------------------------------------ manual SOS
create or replace function public.raise_sos(
  p_elder_id uuid default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_note text default null
) returns public.health_alerts
language plpgsql
set search_path = public
as $$
declare
  v_elder uuid := coalesce(p_elder_id, auth.uid());
  v_row public.health_alerts;
begin
  if v_elder is null then
    raise exception 'no elder context' using errcode = '22023';
  end if;
  if v_elder <> auth.uid() and not public.is_in_circle(v_elder) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- A position from the elder's own device becomes their last known location
  -- (a caregiver raising SOS on their behalf is somewhere else).
  if v_elder = auth.uid() and p_lat between -90 and 90 and p_lon between -180 and 180 then
    insert into public.location_pings (elder_id, captured_at, geog, source)
    values (v_elder, now(), st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography, 'fg');
  end if;

  -- No coordinates in the payload: doctors can read alerts.
  insert into public.health_alerts (elder_id, kind, severity, payload)
  values (
    v_elder,
    'sos',
    'critical',
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'manual_button',
      'note', p_note,
      'raised_by', auth.uid()
    ))
  )
  returning * into v_row;
  return v_row;
end;
$$;

-- A position that arrived after the SOS (the app never holds the SOS back
-- waiting for GPS). Only the elder, only for their own SOS / fall, only within
-- 15 minutes. Sends a location follow-up to the allowed recipients only.
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

  perform public._post_edge('notify-fanout', jsonb_build_object(
    'elder_id', a.elder_id,
    'severity', 'critical',
    'source_kind', 'sos',
    'source_id', a.id,
    'title_ar', 'Location for the SOS: ' || v_name,
    'body_ar', 'Where ' || v_name || ' is now.',
    'texts', jsonb_build_object(
      'en', jsonb_build_object('title', 'Location for the SOS: ' || v_name, 'body', 'Where ' || v_name || ' is now.'),
      'ar', jsonb_build_object('title', 'موقع الاستغاثة: ' || v_name, 'body', 'مكان ' || v_name || ' الآن.')),
    'location', v_loc,
    'location_recipients_only', true));
  return true;
end;
$$;

-- ------------------------------------------------------------------ live location: never doctors
-- Same as before, but gated on can_read_location (which refuses doctors
-- outright) instead of the bare permission flag.
create or replace function public.elder_live_location(p_elder_id uuid)
returns table(captured_at timestamptz, lat double precision, lon double precision, accuracy_m real,
              speed_mps real, battery_pct smallint, is_moving boolean, zone_name text, inside_zone boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last public.location_pings;
  v_zone_name text;
begin
  if not public.can_read_location(p_elder_id) then
    raise exception 'forbidden';
  end if;

  select * into v_last
  from public.location_pings lp
  where lp.elder_id = p_elder_id
  order by lp.captured_at desc
  limit 1;

  if not found then
    return;
  end if;

  -- Smallest active safe zone containing the last fix, if any.
  select sz.name into v_zone_name
  from public.safe_zones sz
  where sz.elder_id = p_elder_id
    and sz.active
    and st_dwithin(sz.center, v_last.geog, sz.radius_m)
  order by sz.radius_m asc
  limit 1;

  return query
  select
    v_last.captured_at,
    st_y(v_last.geog::geometry)::double precision,
    st_x(v_last.geog::geometry)::double precision,
    v_last.accuracy_m,
    v_last.speed_mps,
    v_last.battery_pct,
    v_last.is_moving,
    v_zone_name,
    (v_zone_name is not null);
end;
$$;

-- ------------------------------------------------------------------ existing data
insert into public.alert_locations (alert_id, elder_id, lat, lon, captured_at, source)
select id, elder_id, (payload->>'lat')::double precision, (payload->>'lon')::double precision, created_at, 'migrated_payload'
  from public.health_alerts
 where payload ? 'lat' and payload ? 'lon'
   and jsonb_typeof(payload->'lat') = 'number' and jsonb_typeof(payload->'lon') = 'number'
   and (payload->>'lat')::double precision between -90 and 90
   and (payload->>'lon')::double precision between -180 and 180
on conflict (alert_id) do nothing;

-- Strip only rows whose coordinates were moved (no data can be lost).
update public.health_alerts a
   set payload = a.payload - 'lat' - 'lon'
 where (a.payload ? 'lat' or a.payload ? 'lon')
   and exists (select 1 from public.alert_locations l where l.alert_id = a.id);

-- ------------------------------------------------------------------ permissions
revoke all on function public._last_known_location(uuid)                                 from public, anon, authenticated;
revoke all on function public._location_payload(uuid, double precision, double precision, timestamptz) from public, anon, authenticated;
revoke all on function public._emergency_location(uuid, uuid)                            from public, anon, authenticated;
revoke all on function public._notify_emergency_first(public.health_alerts)              from public, anon, authenticated;
revoke all on function public.add_sos_location(uuid, double precision, double precision, real) from public, anon;
grant execute on function public.add_sos_location(uuid, double precision, double precision, real) to authenticated;
