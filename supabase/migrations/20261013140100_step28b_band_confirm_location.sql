-- step28b — Salem Band: confirmation fallback, location on SOS / falls,
-- criticals always go out.
--
-- 1. MEASURE_NOW fallback (nothing can send MEASURE_NOW to a real band yet).
--    A single good, resting, fresh reading in the critical range opens a
--    band_confirmations row and waits up to 15 minutes for a second good
--    resting reading of the same kind — a MEASURE_NOW result or simply the
--    next scheduled measurement:
--      • second reading past the same threshold → critical alert (confirmed)
--      • second reading normal                  → no alert, both kept (status normal)
--      • second reading warning-range           → first is "not confirmed"; the
--                                                  second gets the normal warning rule
--      • nothing within 15 minutes              → WARNING "Unusual reading, not yet
--                                                  confirmed" to the caregivers
--                                                  (band_expire_confirmations). Never
--                                                  dropped silently.
-- 2. Confirmed criticals always go out: the 15-minute repeat filter from
--    step27c is removed. The one-per-hour limit applies only to ordinary band
--    warnings — never to SOS, falls, confirmed criticals or the "not yet
--    confirmed" warning.
-- 3. Band SOS and fall alerts carry the elder's last known location
--    (alert_locations + the push to allowed recipients, step28a), on every plan.
-- 4. One 30-second job, band_tick(), runs fall escalation and confirmation
--    timeouts (replaces salem_band_fall_escalation).

-- ------------------------------------------------------------------ confirmations
create table if not exists public.band_confirmations (
  id                uuid primary key default gen_random_uuid(),
  elder_id          uuid not null references public.profiles(id) on delete cascade,
  band_id           uuid not null references public.band_devices(id) on delete cascade,
  vital_id          bigint not null,
  kind              text not null check (kind in ('heart_rate', 'spo2')),
  alert_kind        public.alert_kind not null,
  value             numeric not null,
  captured_at       timestamptz not null,
  deadline          timestamptz not null,
  status            text not null default 'pending'
                      check (status in ('pending', 'confirmed', 'normal', 'not_confirmed', 'unconfirmed')),
  resolved_at       timestamptz,
  resolved_by_vital bigint,
  alert_id          uuid references public.health_alerts(id) on delete set null,
  created_at        timestamptz not null default now()
);

comment on table public.band_confirmations is
  'A single critical-range band reading waiting (15 min) for a second one. '
  'confirmed → critical alert; normal → no alert; unconfirmed (timeout) → "not yet confirmed" warning.';

create unique index if not exists band_confirmations_one_pending
  on public.band_confirmations (elder_id, kind) where status = 'pending';
create index if not exists band_confirmations_due
  on public.band_confirmations (deadline) where status = 'pending';

alter table public.band_confirmations enable row level security;
drop policy if exists band_confirmations_read on public.band_confirmations;
create policy band_confirmations_read on public.band_confirmations
  for select to authenticated using (public.has_perm(elder_id, 'health'));

-- ------------------------------------------------------------------ _band_raise + location
drop function if exists public._band_raise(uuid, public.alert_kind, public.alert_severity, jsonb, text, text, text, text);

create or replace function public._band_raise(
  p_elder    uuid,
  p_kind     public.alert_kind,
  p_severity public.alert_severity,
  p_payload  jsonb,
  p_title_en text, p_body_en text,
  p_title_ar text, p_body_ar text,
  p_attach_location boolean default false
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_loc jsonb;
begin
  insert into public.health_alerts (elder_id, kind, severity, payload)
  values (p_elder, p_kind, p_severity,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
            'source', 'band', 'no_fanout', true,
            'title_en', p_title_en, 'body_en', p_body_en,
            'title_ar', p_title_ar, 'body_ar', p_body_ar))
  returning id into v_id;

  -- SOS / falls: last known location for the people allowed to see it.
  if p_attach_location then
    v_loc := public._emergency_location(v_id, p_elder);
  end if;

  perform public._post_edge('notify-fanout', jsonb_build_object(
    'elder_id', p_elder,
    'severity', p_severity,
    'source_kind', case when p_kind = 'sos' then 'sos' else 'health_alert' end,
    'source_id', v_id,
    'title_ar', p_title_en,            -- legacy fields, still required
    'body_ar', p_body_en,
    'texts', jsonb_build_object(
      'en', jsonb_build_object('title', p_title_en, 'body', p_body_en),
      'ar', jsonb_build_object('title', p_title_ar, 'body', p_body_ar)),
    'location', v_loc));
  return v_id;
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
    'تم الضغط على زر الاستغاثة في سوار سليم. اتصل الآن.' || coalesce(' ' || v_ar, ''),
    true);

  update public.band_events
     set status = 'alerted', alert_id = v_alert, resolved_at = now()
   where id = e.id;
  return v_alert;
end;
$$;

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
    v_title_ar, v_body_ar || coalesce(' ' || v_ar, ''),
    true);

  update public.band_events
     set status = 'alerted', alert_id = v_alert, resolved_at = now(),
         resolved_by = p_actor, resolution = p_resolution
   where id = e.id;
  return v_alert;
end;
$$;

-- ------------------------------------------------------------------ ingest
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
  pc public.band_confirmations;
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
    -- Is a single critical-range reading of this kind waiting for this one?
    select * into pc from public.band_confirmations c
     where c.elder_id = p_elder and c.kind = r.kind and c.status = 'pending'
       and c.vital_id <> v_vid
       and c.captured_at between v_at - v_confirm and v_at + v_confirm
     order by c.captured_at
     limit 1
     for update;
    if found then
      if v_sev = 'critical' and v_akind = pc.alert_kind then
        -- Confirmed: always goes out (no repeat filter on criticals).
        insert into public.health_alerts (elder_id, kind, severity, payload)
        values (p_elder, v_akind, 'critical', jsonb_build_object(
          'source', 'band', 'vital_id', v_vid, 'kind', r.kind, 'value', r.value,
          'band_serial', p_serial, 'confirmed', true, 'confirms_vital_id', pc.vital_id))
        returning id into v_aid;
        update public.band_confirmations
           set status = 'confirmed', resolved_at = v_now, resolved_by_vital = v_vid, alert_id = v_aid
         where id = pc.id;
        v_alerts := v_alerts || jsonb_build_object('id', v_aid, 'kind', v_akind, 'severity', 'critical');
        continue;
      elsif v_akind is null then
        -- The second reading is normal: no alert; both readings stay stored.
        update public.band_confirmations
           set status = 'normal', resolved_at = v_now, resolved_by_vital = v_vid
         where id = pc.id;
        continue;
      else
        -- Not the same critical (warning-range, or the other direction): the
        -- first is not confirmed; this reading is judged on its own below.
        update public.band_confirmations
           set status = 'not_confirmed', resolved_at = v_now, resolved_by_vital = v_vid
         where id = pc.id;
      end if;
    end if;

    continue when v_akind is null;

    if v_sev = 'critical' then
      -- A second good, resting reading past the same threshold within the
      -- window, itself fresh when it arrived (e.g. the pending one already
      -- timed out and its confirmation arrived late).
      if exists (
        select 1 from public.vitals w
         where w.elder_id = p_elder and w.source = 'band'
           and w.kind = r.kind::public.vital_kind and w.id <> v_vid
           and w.captured_at between v_at - v_confirm and v_at + v_confirm
           and coalesce(w.is_resting, false) and w.quality >= v_qmin
           and w.captured_at >= w.created_at - v_max_age
           and w.captured_at <= w.created_at + v_future
           and case v_akind when 'hr_low'  then w.value_numeric < 45
                            when 'hr_high' then w.value_numeric > 130
                            else                w.value_numeric < 88 end
      ) then
        insert into public.health_alerts (elder_id, kind, severity, payload)
        values (p_elder, v_akind, 'critical', jsonb_build_object(
          'source', 'band', 'vital_id', v_vid, 'kind', r.kind, 'value', r.value,
          'band_serial', p_serial, 'confirmed', true))
        returning id into v_aid;
        v_alerts := v_alerts || jsonb_build_object('id', v_aid, 'kind', v_akind, 'severity', 'critical');
      else
        -- First one: wait up to 15 minutes for a second reading (MEASURE_NOW
        -- result or the next scheduled one). band_expire_confirmations()
        -- raises "Unusual reading, not yet confirmed" if none arrives.
        insert into public.band_confirmations
          (elder_id, band_id, vital_id, kind, alert_kind, value, captured_at, deadline)
        values (p_elder, b.id, v_vid, r.kind, v_akind, r.value, v_at, v_now + v_confirm)
        on conflict (elder_id, kind) where status = 'pending' do nothing;
        if not (r.kind = any (v_needs)) then
          v_needs := array_append(v_needs, r.kind);
        end if;
      end if;
    else
      -- Ordinary warnings: at most one of a kind per hour. (Never applied to
      -- SOS, falls, confirmed criticals or "not yet confirmed" warnings.)
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

-- ------------------------------------------------------------------ confirmation timeout
create or replace function public.band_expire_confirmations()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  pc   record;
  who  record;
  v_t  text;
  v_v  text;
  v_en text;
  v_ar text;
  v_aid uuid;
  n    int := 0;
begin
  for pc in
    select c.*, bd.serial from public.band_confirmations c
      join public.band_devices bd on bd.id = c.band_id
     where c.status = 'pending' and c.deadline <= now()
     order by c.deadline
     for update of c skip locked
  loop
    select * into who from public._band_elder(pc.elder_id);
    v_t := to_char(pc.captured_at at time zone who.tz, 'HH24:MI');
    v_v := round(pc.value)::text;
    if pc.kind = 'heart_rate' then
      v_en := 'a resting heart rate of ' || v_v || ' beats per minute';
      v_ar := 'نبضًا أثناء الراحة ' || v_v || ' نبضة في الدقيقة';
    else
      v_en := 'a blood oxygen level of ' || v_v || '%';
      v_ar := 'نسبة أكسجين في الدم ' || v_v || '٪';
    end if;

    v_aid := public._band_raise(
      pc.elder_id, pc.alert_kind, 'warning',
      jsonb_build_object('unconfirmed', true, 'vital_id', pc.vital_id, 'kind', pc.kind,
                         'value', pc.value, 'captured_at', pc.captured_at, 'band_serial', pc.serial),
      'Unusual reading, not yet confirmed',
      who.name || '''s Salem Band measured ' || v_en || ' at ' || v_t
        || '. No second reading confirmed it within 15 minutes. Please check on them.',
      'قراءة غير معتادة لم تتأكد بعد',
      'سجّل سوار سليم الخاص بـ' || who.name || ' ' || v_ar || ' الساعة ' || v_t
        || '. لم تؤكدها قراءة ثانية خلال 15 دقيقة. يرجى الاطمئنان.');

    update public.band_confirmations
       set status = 'unconfirmed', resolved_at = now(), alert_id = v_aid
     where id = pc.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Every 30 seconds: unanswered falls, then timed-out confirmations.
create or replace function public.band_tick()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'falls', public.band_escalate_falls(),
    'confirmations', public.band_expire_confirmations());
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname in ('salem_band_fall_escalation', 'salem_band_tick');
select cron.schedule('salem_band_tick', '30 seconds', $cron$ select public.band_tick(); $cron$);

-- ------------------------------------------------------------------ permissions
revoke all on function public._band_raise(uuid, public.alert_kind, public.alert_severity, jsonb, text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public._band_sos_alert(uuid)              from public, anon, authenticated;
revoke all on function public._band_fall_alert(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.band_ingest(uuid, text, jsonb)     from public, anon, authenticated;
revoke all on function public.band_expire_confirmations()        from public, anon, authenticated;
revoke all on function public.band_tick()                        from public, anon, authenticated;
grant execute on function public.band_ingest(uuid, text, jsonb)  to service_role;
grant execute on function public.band_expire_confirmations()     to service_role;
grant execute on function public.band_tick()                     to service_role;
