-- step27c — Salem Band: ingest, alerts, app RPCs, scheduled jobs.
--
--   band_ingest(...)          service role only — called by the band-ingest edge
--                             function after it verified the user and decoded
--                             the packets with _shared/bandProtocol.ts
--   register_band / forget_band / band_status / cancel_band_fall /
--   confirm_band_fall         signed-in app users (each checks who is calling)
--   band_escalate_falls()     every 30 s: unanswered falls → critical alert
--   band_watchdog()           hourly: off wrist / no data → info alert
--   band_purge_raw()          nightly: 90-day raw band retention
--
-- Band SOS, fall, battery, off-wrist and no-data alerts are inserted with
-- payload.no_fanout and pushed directly through notify-fanout with fixed text
-- (including "Delayed: happened at HH:MM"). They never wait on Gemini, so a
-- quota error can't hold one back. Band heart-rate / SpO2 alerts go through
-- the same path as manual ones (analyze-vitals), only with the stricter rules.
--
-- Also fixes a Part A bug: notification_log.source_kind didn't allow 'trend',
-- so Trend Watch notification log rows (and in-app fallbacks) were rejected.

alter table public.notification_log drop constraint if exists notification_log_source_kind_check;
alter table public.notification_log add constraint notification_log_source_kind_check
  check (source_kind = any (array['health_alert','sos','ai_assessment','system','trend']));

-- ------------------------------------------------------------- helpers
create or replace function public._band_cfg(p_key text, p_default numeric)
returns numeric
language sql stable security definer
set search_path = public
as $$
  select coalesce((select value from public.trend_config where key = p_key), p_default);
$$;

-- First name for push text, and the elder's timezone for "HH:MM".
create or replace function public._band_elder(p_elder uuid, out name text, out tz text)
language sql stable security definer
set search_path = public
as $$
  select coalesce(nullif(split_part(trim(coalesce(display_name, '')), ' ', 1), ''), 'Your family member'),
         coalesce(nullif(timezone, ''), 'Africa/Cairo')
    from public.profiles where id = p_elder;
$$;

-- Insert a band alert and push it right away with fixed text.
create or replace function public._band_raise(
  p_elder    uuid,
  p_kind     public.alert_kind,
  p_severity public.alert_severity,
  p_payload  jsonb,
  p_title_en text, p_body_en text,
  p_title_ar text, p_body_ar text
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.health_alerts (elder_id, kind, severity, payload)
  values (p_elder, p_kind, p_severity,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
            'source', 'band', 'no_fanout', true,
            'title_en', p_title_en, 'body_en', p_body_en,
            'title_ar', p_title_ar, 'body_ar', p_body_ar))
  returning id into v_id;

  perform public._post_edge('notify-fanout', jsonb_build_object(
    'elder_id', p_elder,
    'severity', p_severity,
    'source_kind', 'health_alert',
    'source_id', v_id,
    'title_ar', p_title_en,            -- legacy fields, still required
    'body_ar', p_body_en,
    'texts', jsonb_build_object(
      'en', jsonb_build_object('title', p_title_en, 'body', p_body_en),
      'ar', jsonb_build_object('title', p_title_ar, 'body', p_body_ar))));
  return v_id;
end;
$$;

-- "Delayed: happened at 07:00." / "Time unknown." / NULL when on time.
create or replace function public._band_when(p_at timestamptz, p_delayed boolean, p_tz text, p_lang text)
returns text
language sql stable
as $$
  select case
    when p_at is null then case p_lang when 'ar' then 'الوقت غير معروف.' else 'Time unknown.' end
    when p_delayed then case p_lang
      when 'ar' then 'متأخر: حدث الساعة ' || to_char(p_at at time zone p_tz, 'HH24:MI') || '.'
      else 'Delayed: happened at ' || to_char(p_at at time zone p_tz, 'HH24:MI') || '.' end
  end;
$$;

create or replace function public._band_sos_alert(p_event_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  e   public.band_events;
  who record;
  v_alert uuid;
  v_en text; v_ar text;
begin
  select * into e from public.band_events where id = p_event_id for update;
  if e.status = 'alerted' then return e.alert_id; end if;
  select * into who from public._band_elder(e.elder_id);
  v_en := public._band_when(e.occurred_at, e.delayed, who.tz, 'en');
  v_ar := public._band_when(e.occurred_at, e.delayed, who.tz, 'ar');

  v_alert := public._band_raise(
    e.elder_id, 'sos', 'critical',
    jsonb_build_object(
      'band_event_id', e.id,
      'band_serial', (select serial from public.band_devices where id = e.band_id),
      'occurred_at', e.occurred_at,
      'held_seconds', e.data / 10.0,
      'delayed', e.delayed,
      'delayed_label', case when e.delayed then to_char(e.occurred_at at time zone who.tz, 'HH24:MI') end,
      'time_unknown', e.occurred_at is null),
    'SOS from ' || who.name,
    who.name || ' pressed the SOS button on the Salem Band. Call them now.' || coalesce(' ' || v_en, ''),
    'استغاثة من ' || who.name,
    'تم الضغط على زر الاستغاثة في سوار سليم. اتصل الآن.' || coalesce(' ' || v_ar, ''));

  update public.band_events
     set status = 'alerted', alert_id = v_alert, resolved_at = now()
   where id = e.id;
  return v_alert;
end;
$$;

-- p_resolution: 'timeout' (no answer), 'elder_help' ("Get help"), 'late'
-- (the fall reached the server after the 15-minute window).
create or replace function public._band_fall_alert(p_event_id uuid, p_resolution text, p_actor uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  e   public.band_events;
  who record;
  v_alert uuid;
  v_en text; v_ar text;
  v_title_en text; v_body_en text; v_title_ar text; v_body_ar text;
begin
  select * into e from public.band_events where id = p_event_id for update;
  if e.kind <> 'fall' then raise exception 'not_a_fall' using errcode = '22023'; end if;
  if e.status = 'alerted' then return e.alert_id; end if;
  select * into who from public._band_elder(e.elder_id);
  v_en := public._band_when(e.occurred_at, e.delayed, who.tz, 'en');
  v_ar := public._band_when(e.occurred_at, e.delayed, who.tz, 'ar');

  if p_resolution = 'elder_help' then
    v_title_en := who.name || ' asked for help after a fall';
    v_body_en  := 'The Salem Band detected a fall and ' || who.name || ' pressed "Get help". Call them now.';
    v_title_ar := 'طلب مساعدة بعد سقوط: ' || who.name;
    v_body_ar  := 'اكتشف سوار سليم سقوطًا وتم الضغط على «أحتاج مساعدة». اتصل الآن.';
  elsif p_resolution = 'late' then
    v_title_en := 'Possible fall: ' || who.name;
    v_body_en  := 'The Salem Band detected a fall while the phone was out of range. Call them now.';
    v_title_ar := 'احتمال سقوط: ' || who.name;
    v_body_ar  := 'اكتشف سوار سليم سقوطًا بينما كان الهاتف بعيدًا. اتصل الآن.';
  else
    v_title_en := 'Possible fall: ' || who.name;
    v_body_en  := 'The Salem Band detected a fall and nobody answered "Are you OK?". Call them now.';
    v_title_ar := 'احتمال سقوط: ' || who.name;
    v_body_ar  := 'اكتشف سوار سليم سقوطًا ولم يأتِ رد على «هل أنت بخير؟». اتصل الآن.';
  end if;

  v_alert := public._band_raise(
    e.elder_id, 'fall_detected', 'critical',
    jsonb_build_object(
      'band_event_id', e.id,
      'band_serial', (select serial from public.band_devices where id = e.band_id),
      'occurred_at', e.occurred_at,
      'impact_g', e.data / 100.0,
      'resolution', p_resolution,
      'delayed', e.delayed,
      'delayed_label', case when e.delayed then to_char(e.occurred_at at time zone who.tz, 'HH24:MI') end,
      'time_unknown', e.occurred_at is null),
    v_title_en, v_body_en || coalesce(' ' || v_en, ''),
    v_title_ar, v_body_ar || coalesce(' ' || v_ar, ''));

  update public.band_events
     set status = 'alerted', alert_id = v_alert, resolved_at = now(),
         resolved_by = p_actor, resolution = p_resolution
   where id = e.id;
  return v_alert;
end;
$$;

-- ------------------------------------------------------------- ingest
-- p_upload = {
--   firmware_version?, battery_pct?,
--   records:  [{kind, t, value, quality, resting}]   value already scaled
--   events:   [{kind, t, data, flags}]
--   rejected: {reason: count}                         dropped by the edge function
-- }
create or replace function public.band_ingest(p_elder uuid, p_serial text, p_upload jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_now        timestamptz := now();
  b            public.band_devices;
  who          record;
  v_qmin       int      := public._band_cfg('band_quality_min', 60)::int;
  v_max_age    interval := make_interval(mins => public._band_cfg('band_realtime_max_age_minutes', 15)::int);
  v_future     interval := make_interval(secs => public._band_cfg('band_future_tolerance_seconds', 120));
  v_confirm    interval := make_interval(mins => public._band_cfg('band_confirm_window_minutes', 15)::int);
  v_warn_rep   interval := make_interval(mins => public._band_cfg('band_warning_repeat_minutes', 60)::int);
  v_grace      int      := public._band_cfg('band_fall_grace_seconds', 30)::int;
  v_batt_rep   interval := make_interval(hours => public._band_cfg('band_low_battery_repeat_hours', 12)::int);
  r            record;
  e            record;
  v_at         timestamptz;
  v_vid        bigint;
  v_ev         uuid;
  v_aid        uuid;
  v_akind      public.alert_kind;
  v_sev        public.alert_severity;
  v_clock_ok   boolean;
  v_delayed    boolean;
  n_acc int := 0; n_dup int := 0; n_low int := 0; n_old int := 0; n_bad int := 0;
  n_ev  int := 0; n_ev_dup int := 0;
  v_min timestamptz; v_max timestamptz;
  v_needs   text[] := '{}';
  v_alerts  jsonb := '[]';
  v_pending jsonb := '[]';
  v_acks    jsonb := '[]';
  v_rejected jsonb := case when jsonb_typeof(p_upload->'rejected') = 'object' then p_upload->'rejected' else '{}'::jsonb end;
  v_client_rejected int;
  v_batt int;
begin
  select * into b from public.band_devices
   where serial = p_serial and forgotten_at is null
   for update;
  if not found or b.elder_id <> p_elder then
    raise exception 'band_not_registered' using errcode = 'P0001';
  end if;
  select * into who from public._band_elder(p_elder);

  -- ---------------------------------------------------------- records
  for r in
    select x.* from jsonb_to_recordset(coalesce(p_upload->'records', '[]'::jsonb))
      as x(kind text, t bigint, value numeric, quality int, resting boolean)
    order by x.t
  loop
    if r.kind is null or r.kind not in ('heart_rate','spo2','skin_temperature','steps','movement')
       or r.t is null or r.t < 1704067200 or r.value is null
       or (r.quality is not null and r.quality not between 0 and 100) then
      n_bad := n_bad + 1;
      continue;
    end if;

    v_at := to_timestamp(r.t);
    v_vid := null;
    insert into public.vitals
      (elder_id, kind, value_numeric, unit, source, device_id, captured_at, created_by, is_resting, quality)
    values
      (p_elder, r.kind::public.vital_kind, r.value,
       case r.kind when 'heart_rate' then 'bpm' when 'spo2' then '%' when 'skin_temperature' then '°C'
                   when 'steps' then 'steps' else 'count' end,
       'band', p_serial, v_at, p_elder, r.resting, r.quality)
    on conflict (device_id, kind, captured_at) where source = 'band' do nothing
    returning id into v_vid;

    if v_vid is null then n_dup := n_dup + 1; continue; end if;
    n_acc := n_acc + 1;
    v_min := least(v_min, v_at);
    v_max := greatest(v_max, v_at);

    -- Real-time check: HR / SpO2 only, good quality, fresh, resting.
    continue when r.kind not in ('heart_rate', 'spo2');
    if r.quality is null or r.quality < v_qmin then n_low := n_low + 1; continue; end if;
    if v_at < v_now - v_max_age or v_at > v_now + v_future then n_old := n_old + 1; continue; end if;
    continue when not coalesce(r.resting, false);

    -- Same thresholds as manual readings (maybe_emit_vital_alert).
    v_akind := null; v_sev := null;
    if r.kind = 'heart_rate' then
      if    r.value < 45  then v_akind := 'hr_low';  v_sev := 'critical';
      elsif r.value < 50  then v_akind := 'hr_low';  v_sev := 'warning';
      elsif r.value > 130 then v_akind := 'hr_high'; v_sev := 'critical';
      elsif r.value > 110 then v_akind := 'hr_high'; v_sev := 'warning';
      end if;
    else
      if    r.value < 88 then v_akind := 'spo2_low'; v_sev := 'critical';
      elsif r.value < 92 then v_akind := 'spo2_low'; v_sev := 'warning';
      end if;
    end if;
    continue when v_akind is null;

    if v_sev = 'critical' then
      -- Needs a second good, resting reading past the same threshold within
      -- the window, which was itself fresh when it arrived.
      if exists (
        select 1 from public.vitals w
         where w.elder_id = p_elder and w.source = 'band'
           and w.kind = r.kind::public.vital_kind and w.id <> v_vid
           and w.captured_at between v_at - v_confirm and v_at + v_confirm
           and coalesce(w.is_resting, false) and w.quality >= v_qmin
           and w.created_at - w.captured_at <= v_max_age
           and case v_akind when 'hr_low'  then w.value_numeric < 45
                            when 'hr_high' then w.value_numeric > 130
                            else                w.value_numeric < 88 end
      ) then
        if not exists (
          select 1 from public.health_alerts a
           where a.elder_id = p_elder and a.kind = v_akind and a.severity = 'critical'
             and a.payload->>'source' = 'band' and a.created_at > v_now - v_confirm
        ) then
          insert into public.health_alerts (elder_id, kind, severity, payload)
          values (p_elder, v_akind, 'critical', jsonb_build_object(
            'source', 'band', 'vital_id', v_vid, 'kind', r.kind, 'value', r.value,
            'band_serial', p_serial, 'confirmed', true))
          returning id into v_aid;
          v_alerts := v_alerts || jsonb_build_object('id', v_aid, 'kind', v_akind, 'severity', 'critical');
        end if;
      elsif not (r.kind = any (v_needs)) then
        v_needs := array_append(v_needs, r.kind);
      end if;
    else
      if not exists (
        select 1 from public.health_alerts a
         where a.elder_id = p_elder and a.kind = v_akind and a.severity in ('warning', 'critical')
           and a.payload->>'source' = 'band' and a.created_at > v_now - v_warn_rep
      ) then
        insert into public.health_alerts (elder_id, kind, severity, payload)
        values (p_elder, v_akind, 'warning', jsonb_build_object(
          'source', 'band', 'vital_id', v_vid, 'kind', r.kind, 'value', r.value, 'band_serial', p_serial))
        returning id into v_aid;
        v_alerts := v_alerts || jsonb_build_object('id', v_aid, 'kind', v_akind, 'severity', 'warning');
      end if;
    end if;
  end loop;

  -- ---------------------------------------------------------- events
  for e in
    select x.* from jsonb_to_recordset(coalesce(p_upload->'events', '[]'::jsonb))
      as x(kind text, t bigint, data int, flags int)
    order by x.t
  loop
    if e.kind is null or e.t is null or e.kind not in
       ('sos','fall','off_wrist','on_wrist','low_battery','charging','fall_cancelled') then
      n_bad := n_bad + 1;
      continue;
    end if;

    -- SOS / FALL are never skipped: a late one alerts with its time, an
    -- unset or impossible clock alerts as "time unknown".
    v_clock_ok := (coalesce(e.flags, 0) & 2) = 0 and e.t >= 1704067200
                  and to_timestamp(e.t) <= v_now + v_future;
    v_at := case when v_clock_ok then to_timestamp(e.t) end;
    v_delayed := v_clock_ok and v_at < v_now - v_max_age;

    v_ev := null;
    insert into public.band_events (elder_id, band_id, kind, band_time, occurred_at, data, flags, delayed)
    values (p_elder, b.id, e.kind, e.t, v_at, coalesce(e.data, 0), coalesce(e.flags, 0), v_delayed)
    on conflict (band_id, kind, band_time) do nothing
    returning id into v_ev;

    -- Acknowledge duplicates too, so the band clears its log.
    v_acks := v_acks || jsonb_build_object('kind', e.kind, 't', e.t);
    if v_ev is null then n_ev_dup := n_ev_dup + 1; continue; end if;
    n_ev := n_ev + 1;

    if e.kind = 'sos' then
      v_aid := public._band_sos_alert(v_ev);
      v_alerts := v_alerts || jsonb_build_object('id', v_aid, 'kind', 'sos', 'severity', 'critical', 'delayed', v_delayed);

    elsif e.kind = 'fall' then
      if exists (
        select 1 from jsonb_to_recordset(p_upload->'events') as c(kind text, t bigint)
         where c.kind = 'fall_cancelled' and c.t between e.t and e.t + v_grace
      ) then
        update public.band_events
           set status = 'cancelled', resolved_at = v_now, resolved_by = p_elder, resolution = 'band_button'
         where id = v_ev;
      elsif v_delayed then
        v_aid := public._band_fall_alert(v_ev, 'late', null);
        v_alerts := v_alerts || jsonb_build_object('id', v_aid, 'kind', 'fall_detected', 'severity', 'critical', 'delayed', true);
      else
        update public.band_events
           set status = 'pending', respond_by = v_now + make_interval(secs => v_grace)
         where id = v_ev;
        v_pending := v_pending || jsonb_build_object('id', v_ev, 'respond_by', v_now + make_interval(secs => v_grace));
      end if;

    elsif e.kind = 'fall_cancelled' then
      update public.band_events f
         set status = 'cancelled', resolved_at = v_now, resolved_by = p_elder, resolution = 'band_button'
       where f.band_id = b.id and f.kind = 'fall' and f.status = 'pending'
         and f.band_time between e.t - v_grace - 5 and e.t;

    elsif e.kind in ('off_wrist', 'on_wrist') then
      if b.worn_changed_at is null or coalesce(v_at, v_now) >= b.worn_changed_at then
        update public.band_devices
           set worn = (e.kind = 'on_wrist'), worn_changed_at = coalesce(v_at, v_now)
         where id = b.id
        returning * into b;
      end if;

    elsif e.kind = 'low_battery' then
      v_batt := least(100, greatest(0, coalesce(e.data, 0)));
      update public.band_devices set battery_pct = v_batt where id = b.id returning * into b;
      if b.low_battery_alerted_at is null or b.low_battery_alerted_at < v_now - v_batt_rep then
        v_aid := public._band_raise(
          p_elder, 'low_battery', 'info',
          jsonb_build_object('band_serial', p_serial, 'battery_pct', v_batt),
          'Band battery low',
          who.name || '''s Salem Band is at ' || v_batt || '%. Please charge it.',
          'بطارية السوار منخفضة',
          'بطارية سوار سليم الخاص بـ' || who.name || ' عند ' || v_batt || '٪. يرجى شحنه.');
        update public.band_devices set low_battery_alerted_at = v_now where id = b.id returning * into b;
        v_alerts := v_alerts || jsonb_build_object('id', v_aid, 'kind', 'low_battery', 'severity', 'info');
      end if;

    elsif e.kind = 'charging' then
      update public.band_devices set is_charging = (coalesce(e.data, 0) = 1) where id = b.id returning * into b;
    end if;
  end loop;

  -- ---------------------------------------------------------- device state
  -- Battery read from the Battery service is current, so it wins over events.
  v_batt := case when jsonb_typeof(p_upload->'battery_pct') = 'number'
                 then least(100, greatest(0, (p_upload->>'battery_pct')::numeric::int)) end;
  update public.band_devices
     set last_upload_at   = v_now,
         last_record_at   = greatest(last_record_at, v_max),
         battery_pct      = coalesce(v_batt, battery_pct),
         firmware_version = coalesce(nullif(left(p_upload->>'firmware_version', 32), ''), firmware_version),
         -- Records are only taken on the wrist: data with no worn state yet means worn.
         worn             = case when worn is null and v_max is not null then true else worn end
   where id = b.id;

  -- ---------------------------------------------------------- one audit row per batch
  select coalesce(sum(case when jsonb_typeof(value) = 'number' then (value)::numeric::int end), 0)
    into v_client_rejected
    from jsonb_each(v_rejected);

  insert into public.audit_log (actor_id, action, resource_type, resource_id, elder_id, payload)
  values (p_elder, 'BAND_UPLOAD', 'vitals', b.id::text, p_elder, jsonb_build_object(
    'band_serial', p_serial,
    'rows', n_acc,
    'from', v_min, 'to', v_max,
    'accepted', n_acc,
    'duplicates', n_dup,
    'rejected', v_client_rejected + n_bad,
    'rejected_reasons', v_rejected || case when n_bad > 0 then jsonb_build_object('server_invalid', n_bad) else '{}'::jsonb end,
    'low_quality', n_low,
    'not_realtime_checked_old', n_old,
    'events', n_ev,
    'event_duplicates', n_ev_dup));

  return jsonb_build_object(
    'accepted', n_acc,
    'duplicates', n_dup,
    'rejected', v_client_rejected + n_bad,
    'low_quality', n_low,
    'stored_not_checked', n_old,
    'events', n_ev,
    'event_duplicates', n_ev_dup,
    'needs_confirmation', to_jsonb(v_needs),
    'alerts', v_alerts,
    'pending_falls', v_pending,
    'ack_events', v_acks);
end;
$$;

-- ------------------------------------------------------------- app RPCs
create or replace function public.register_band(p_serial text, p_model text default null, p_firmware text default null)
returns public.band_devices
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.band_devices;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'elder') then
    raise exception 'only_the_elder_can_pair_a_band' using errcode = '42501';
  end if;
  if p_serial is null or p_serial !~ '^[A-Za-z0-9-]{4,32}$' then
    raise exception 'bad_serial' using errcode = '22023';
  end if;

  select * into v_row from public.band_devices
   where serial = p_serial and forgotten_at is null for update;
  if found then
    if v_row.elder_id <> v_uid then raise exception 'band_in_use' using errcode = 'P0001'; end if;
    update public.band_devices
       set model = coalesce(left(p_model, 64), model),
           firmware_version = coalesce(left(p_firmware, 32), firmware_version)
     where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  -- One band per elder: pairing a new one forgets the old one.
  update public.band_devices set forgotten_at = now() where elder_id = v_uid and forgotten_at is null;
  insert into public.band_devices (elder_id, serial, model, firmware_version)
  values (v_uid, p_serial, left(p_model, 64), left(p_firmware, 32))
  returning * into v_row;

  insert into public.audit_log (actor_id, action, resource_type, resource_id, elder_id, payload)
  values (v_uid, 'BAND_PAIRED', 'band_devices', v_row.id::text, v_uid, jsonb_build_object('serial', p_serial));
  return v_row;
end;
$$;

-- The elder, or a circle member who can manage the circle.
create or replace function public.forget_band(p_elder_id uuid default null)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_elder uuid := coalesce(p_elder_id, auth.uid());
  v_id    uuid;
begin
  if v_uid is null or not (v_elder = v_uid or public.has_perm(v_elder, 'manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.band_devices set forgotten_at = now()
   where elder_id = v_elder and forgotten_at is null
  returning id into v_id;
  if v_id is null then return false; end if;
  insert into public.audit_log (actor_id, action, resource_type, resource_id, elder_id, payload)
  values (v_uid, 'BAND_FORGOTTEN', 'band_devices', v_id::text, v_elder, '{}'::jsonb);
  return true;
end;
$$;

-- "I'm OK" on the "Are you OK?" screen. Only the elder.
-- Returns 'cancelled', or 'alerted' when the family was already told.
create or replace function public.cancel_band_fall(p_event_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  e public.band_events;
begin
  select * into e from public.band_events where id = p_event_id for update;
  if not found or e.elder_id is distinct from auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if e.kind <> 'fall' then raise exception 'not_a_fall' using errcode = '22023'; end if;
  if e.status = 'pending' then
    update public.band_events
       set status = 'cancelled', resolved_at = now(), resolved_by = auth.uid(), resolution = 'elder_ok'
     where id = e.id;
    return 'cancelled';
  end if;
  return e.status;
end;
$$;

-- "Get help" on the "Are you OK?" screen: alert now, don't wait.
create or replace function public.confirm_band_fall(p_event_id uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  e public.band_events;
begin
  select * into e from public.band_events where id = p_event_id for update;
  if not found or e.elder_id is distinct from auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if e.kind <> 'fall' then raise exception 'not_a_fall' using errcode = '22023'; end if;
  if e.status in ('pending', 'cancelled') then
    perform public._band_fall_alert(e.id, 'elder_help', auth.uid());
  end if;
  return 'alerted';
end;
$$;

-- Status card for the elder and anyone with read-health.
create or replace function public.band_status(p_elder_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  d      public.band_devices;
  v_tz   text;
  v_mins int;
  v_fall jsonb;
begin
  if not public.has_perm(p_elder_id, 'health') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into d from public.band_devices where elder_id = p_elder_id and forgotten_at is null;
  if not found then return jsonb_build_object('paired', false); end if;

  select coalesce(nullif(timezone, ''), 'Africa/Cairo') into v_tz from public.profiles where id = p_elder_id;
  -- One STEPS record per 10-minute block, only while worn.
  select count(*) * 10 into v_mins
    from public.vitals
   where elder_id = p_elder_id and source = 'band' and kind = 'steps'
     and captured_at >= (date_trunc('day', now() at time zone v_tz) at time zone v_tz);

  select jsonb_build_object('id', id, 'respond_by', respond_by, 'occurred_at', occurred_at)
    into v_fall
    from public.band_events
   where elder_id = p_elder_id and kind = 'fall' and status = 'pending'
   order by respond_by
   limit 1;

  return jsonb_build_object(
    'paired', true,
    'serial_last4', right(d.serial, 4),
    'model', d.model,
    'firmware_version', d.firmware_version,
    'battery_pct', d.battery_pct,
    'is_charging', d.is_charging,
    'worn', d.worn,
    'worn_changed_at', d.worn_changed_at,
    'last_upload_at', d.last_upload_at,
    'last_record_at', d.last_record_at,
    'paired_at', d.paired_at,
    'worn_minutes_today', v_mins,
    'pending_fall', v_fall,
    'server_time', now());
end;
$$;

-- ------------------------------------------------------------- scheduled jobs
create or replace function public.band_escalate_falls()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
  n    int := 0;
begin
  for v_id in
    select id from public.band_events
     where status = 'pending' and respond_by <= now()
     order by respond_by
     for update skip locked
  loop
    perform public._band_fall_alert(v_id, 'timeout', null);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.band_watchdog()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  d       record;
  who     record;
  v_hour  int;
  v_start int      := public._band_cfg('band_awake_start_hour', 8)::int;
  v_end   int      := public._band_cfg('band_awake_end_hour', 22)::int;
  v_off   interval := make_interval(hours => public._band_cfg('band_offwrist_alert_hours', 2)::int);
  v_quiet interval := make_interval(hours => public._band_cfg('band_no_data_hours', 12)::int);
  v_last  timestamptz;
  n       int := 0;
begin
  for d in select * from public.band_devices where forgotten_at is null loop
    select * into who from public._band_elder(d.elder_id);
    v_hour := extract(hour from now() at time zone who.tz);
    continue when v_hour < v_start or v_hour >= v_end;

    if d.worn = false and d.worn_changed_at < now() - v_off
       and (d.off_wrist_alerted_at is null or d.off_wrist_alerted_at < d.worn_changed_at) then
      perform public._band_raise(
        d.elder_id, 'band_off_wrist', 'info',
        jsonb_build_object('band_serial', d.serial, 'off_since', d.worn_changed_at, 'is_charging', d.is_charging),
        'Band not worn',
        who.name || '''s Salem Band has been off the wrist since '
          || to_char(d.worn_changed_at at time zone who.tz, 'HH24:MI') || '.'
          || case when d.is_charging then ' It is charging.' else '' end,
        'السوار غير ملبوس',
        'سوار سليم الخاص بـ' || who.name || ' خارج المعصم منذ الساعة '
          || to_char(d.worn_changed_at at time zone who.tz, 'HH24:MI') || '.'
          || case when d.is_charging then ' السوار على الشاحن.' else '' end);
      update public.band_devices set off_wrist_alerted_at = now() where id = d.id;
      n := n + 1;
    end if;

    v_last := coalesce(d.last_upload_at, d.paired_at);
    if v_last < now() - v_quiet
       and (d.no_data_alerted_at is null or d.no_data_alerted_at < v_last) then
      perform public._band_raise(
        d.elder_id, 'band_no_data', 'info',
        jsonb_build_object('band_serial', d.serial, 'last_upload_at', d.last_upload_at),
        'No data from the band',
        'Salem has not received anything from ' || who.name || '''s band since '
          || to_char(v_last at time zone who.tz, 'DD Mon HH24:MI')
          || '. Check that the band is charged and the phone is nearby.',
        'لا توجد بيانات من السوار',
        'لم يستقبل سليم أي بيانات من سوار ' || who.name || ' منذ '
          || to_char(v_last at time zone who.tz, 'DD/MM HH24:MI')
          || '. تأكد أن السوار مشحون وأن الهاتف قريب.');
      update public.band_devices set no_data_alerted_at = now() where id = d.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- 90-day raw band retention. Manual readings and daily summaries untouched.
create or replace function public.band_purge_raw()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_days int := public._band_cfg('band_raw_retention_days', 90)::int;
  v_cut  timestamptz := now() - make_interval(days => v_days);
  n_v    int;
  n_e    int;
  v_out  jsonb;
begin
  delete from public.vitals where source = 'band' and captured_at < v_cut;
  get diagnostics n_v = row_count;
  delete from public.band_events where received_at < v_cut and status <> 'pending';
  get diagnostics n_e = row_count;

  v_out := jsonb_build_object('rule', 'band_raw_retention', 'days', v_days, 'cutoff', v_cut,
                              'vitals_deleted', n_v, 'band_events_deleted', n_e);
  insert into public.audit_log (actor_id, action, resource_type, resource_id, elder_id, payload)
  values (null, 'RETENTION_PURGE', 'vitals', null, null, v_out);
  return v_out;
end;
$$;

-- ------------------------------------------------------------- permissions
revoke all on function public._band_cfg(text, numeric)                                  from public, anon, authenticated;
revoke all on function public._band_elder(uuid)                                         from public, anon, authenticated;
revoke all on function public._band_raise(uuid, public.alert_kind, public.alert_severity, jsonb, text, text, text, text)
                                                                                        from public, anon, authenticated;
revoke all on function public._band_when(timestamptz, boolean, text, text)              from public, anon, authenticated;
revoke all on function public._band_sos_alert(uuid)                                     from public, anon, authenticated;
revoke all on function public._band_fall_alert(uuid, text, uuid)                        from public, anon, authenticated;
revoke all on function public.band_ingest(uuid, text, jsonb)                            from public, anon, authenticated;
revoke all on function public.band_escalate_falls()                                     from public, anon, authenticated;
revoke all on function public.band_watchdog()                                           from public, anon, authenticated;
revoke all on function public.band_purge_raw()                                          from public, anon, authenticated;
revoke all on function public.register_band(text, text, text)                           from public, anon;
revoke all on function public.forget_band(uuid)                                         from public, anon;
revoke all on function public.cancel_band_fall(uuid)                                    from public, anon;
revoke all on function public.confirm_band_fall(uuid)                                   from public, anon;
revoke all on function public.band_status(uuid)                                         from public, anon;

grant execute on function public.band_ingest(uuid, text, jsonb)  to service_role;
grant execute on function public.band_escalate_falls()           to service_role;
grant execute on function public.band_watchdog()                 to service_role;
grant execute on function public.band_purge_raw()                to service_role;
grant execute on function public.register_band(text, text, text) to authenticated;
grant execute on function public.forget_band(uuid)               to authenticated;
grant execute on function public.cancel_band_fall(uuid)          to authenticated;
grant execute on function public.confirm_band_fall(uuid)         to authenticated;
grant execute on function public.band_status(uuid)               to authenticated;
