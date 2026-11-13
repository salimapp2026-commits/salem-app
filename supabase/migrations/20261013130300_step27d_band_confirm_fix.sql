-- step27d — band_ingest: a reading from the future must not confirm a critical.
--
-- Found by scripts/band/checks.sql: a band HR 140 timestamped 10 minutes ahead
-- was correctly treated as "old" (no real-time check), but it still counted as
-- the second reading that confirms a later critical HR, because the
-- "fresh when it arrived" test only bounded the past side. Now both sides are
-- bounded, exactly like the 15-minute rule for the reading itself.
--
-- Only this one condition changes; the function is otherwise identical to step27c.

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
           -- the other reading was itself fresh when it arrived: not old, not ahead
           and w.captured_at >= w.created_at - v_max_age
           and w.captured_at <= w.created_at + v_future
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

revoke all on function public.band_ingest(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.band_ingest(uuid, text, jsonb) to service_role;
