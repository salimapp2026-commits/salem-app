-- step32o — the Arabic fallback fields in four more pushes (founder, 2026-11-08). Safe to
-- apply twice. Needs step29b, step32e, step32h, step32j.
--
-- Same as step32n did for the low-mood push: notify-fanout shows title_ar / body_ar only
-- when a caller's `texts` lacks a language. These four always send both languages, so
-- nothing on a phone changes today — but their fallback fields held the English text.
-- Each function below is its live version (checked byte for byte against the server on
-- 2026-11-08) with only its title_ar / body_ar lines changed. Grants are restated as
-- they are live.

-- ── Medicine reminder to the elder (live body = step32e) ─────────────────────────
create or replace function public.dispatch_due_reminders(p_max integer default 100)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_event record;
  v_count int := 0;
  v_max   int := public._reminder_cfg('max_reminders', 3);
  v_tz    text;
  v_me    text;
  v_time  text;
  v_en    text;
  v_ar    text;
begin
  for v_event in
    select e.id as event_id, e.elder_id, e.scheduled_at, r.kind, r.title,
           coalesce(e.next_reminder_at, e.scheduled_at) as due_at
    from public.reminder_events e
    join public.reminders r on r.id = e.reminder_id
    where e.status in ('pending', 'snoozed')
      and r.active = true
      and coalesce(e.next_reminder_at, e.scheduled_at) <= now()
      and coalesce(e.next_reminder_at, e.scheduled_at) > now() - interval '30 minutes'
      and (e.dispatched_at is null or e.dispatched_at < coalesce(e.next_reminder_at, e.scheduled_at))
      and e.reminders_sent < v_max
    order by e.scheduled_at asc
    limit greatest(1, least(coalesce(p_max, 100), 500))
    for update of e skip locked
  loop
    -- Marked first, in this transaction: the next minute's run cannot send it again.
    update public.reminder_events
       set dispatched_at = now(), reminders_sent = reminders_sent + 1
     where id = v_event.event_id;

    select coalesce(nullif(p.timezone, ''), 'Africa/Cairo'),
           nullif(split_part(trim(coalesce(p.display_name, '')), ' ', 1), '')
      into v_tz, v_me
      from public.profiles p where p.id = v_event.elder_id;
    if not exists (select 1 from pg_timezone_names z where z.name = v_tz) then v_tz := 'Africa/Cairo'; end if;
    v_time := to_char(v_event.scheduled_at at time zone v_tz, 'HH24:MI');

    if v_event.kind = 'medication' then
      v_en := public._rafiq_fill(coalesce(public._rafiq_pick('reminder_dose', 'en'), 'Time for your {med} ({time}).'), v_me, v_event.title, v_time);
      v_ar := public._rafiq_fill(coalesce(public._rafiq_pick('reminder_dose', 'ar'), 'ميعاد {med} (الساعة {time}).'), v_me, v_event.title, v_time);
    else
      v_en := coalesce(v_event.title, 'Reminder') || ' (' || v_time || ')';
      v_ar := coalesce(v_event.title, 'تذكير') || ' (' || v_time || ')';
    end if;

    begin
      perform public._post_edge('notify-fanout', jsonb_build_object(
        'elder_id', v_event.elder_id,
        'recipients', 'elder',
        'severity', 'info',
        'source_kind', 'reminder',
        'source_id', null,
        'title_ar', 'رفيق · الدواء',
        'body_ar', v_ar,
        'texts', jsonb_build_object(
          'en', jsonb_build_object('title', 'Rafiq · Medicine', 'body', v_en),
          'ar', jsonb_build_object('title', 'رفيق · الدواء', 'body', v_ar)),
        'buttons', case when v_event.kind = 'medication' then jsonb_build_array(
          jsonb_build_object('id', 'taken',   'en', 'Taken',   'ar', 'أخذته'),
          jsonb_build_object('id', 'not_yet', 'en', 'Not yet', 'ar', 'لسه'),
          jsonb_build_object('id', 'later',   'en', 'Later',   'ar', 'بعدين')) else null end,
        'extra_data', jsonb_build_object('event_id', v_event.event_id),
        'ttl_seconds', 3600));
    exception when others then
      raise warning 'salem: reminder push failed for event %: %', v_event.event_id, sqlerrm;
    end;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.dispatch_due_reminders(integer) from public, anon, authenticated;

-- ── Missed dose to the primary caretaker (live body = step32h) ───────────────────
create or replace function public.expire_stale_reminder_events()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_on    boolean := coalesce((select (value->>'missed_notify_primary')::boolean
                                 from public.app_config where key = 'reminders'), true);
  v_count int := 0;
  v_e     record;
  v_tz    text;
  v_name  text;
  v_time  text;
  v_en    text;
  v_ar    text;
begin
  -- A stopped medicine (reminder turned off) is never reminded (dispatch skips it), so
  -- its open doses are closed as skipped — never "missed", never a push to the family.
  update public.reminder_events e
     set status = 'skipped', next_reminder_at = null
    from public.reminders r
   where r.id = e.reminder_id and not r.active
     and e.status in ('pending', 'snoozed')
     and e.scheduled_at <= now();

  for v_e in
    with upd as (
      update public.reminder_events e
         set status = 'missed',
             missed_notified_at = case
               when v_on and coalesce(e.next_reminder_at, e.scheduled_at) > now() - interval '6 hours'
                and exists (select 1 from public.reminders r where r.id = e.reminder_id and r.kind = 'medication')
               then now() end
       where e.status in ('pending', 'snoozed')
         and coalesce(e.next_reminder_at, e.scheduled_at)
             < now() - make_interval(mins => public._reminder_cfg('missed_after_minutes', 60))
       returning e.id, e.elder_id, e.reminder_id, e.scheduled_at, e.missed_notified_at
    )
    select upd.*, r.title from upd join public.reminders r on r.id = upd.reminder_id
  loop
    v_count := v_count + 1;
    continue when v_e.missed_notified_at is null;

    select coalesce(nullif(p.timezone, ''), 'Africa/Cairo'),
           nullif(split_part(trim(coalesce(p.display_name, '')), ' ', 1), '')
      into v_tz, v_name
      from public.profiles p where p.id = v_e.elder_id;
    if v_tz is null or not exists (select 1 from pg_timezone_names z where z.name = v_tz) then
      v_tz := 'Africa/Cairo';
    end if;
    v_time := to_char(v_e.scheduled_at at time zone v_tz, 'HH24:MI');

    if v_name is null then
      v_en := coalesce(v_e.title, 'A medicine') || ' (' || v_time || ') hasn''t been confirmed as taken. You may want to check in.';
      v_ar := 'دواء ' || coalesce(v_e.title, '') || ' بتاع الساعة ' || v_time || ' لسه ما اتأكدش. ممكن تتصل تطمّن.';
    else
      v_en := v_name || ' hasn''t confirmed taking ' || coalesce(v_e.title, 'a medicine') || ' (' || v_time || '). You may want to check in.';
      v_ar := 'دواء ' || coalesce(v_e.title, '') || ' بتاع الساعة ' || v_time || ' لسه ما اتأكدش عند ' || v_name || '. ممكن تتصل تطمّن.';
    end if;

    begin
      perform public._post_edge('notify-fanout', jsonb_build_object(
        'elder_id', v_e.elder_id,
        'severity', 'info',                -- normal urgency; 'info' routes to primary caretakers only
        'source_kind', 'reminder_missed',
        'source_id', null,
        'title_ar', 'جرعة ما اتأكدتش',
        'body_ar', v_ar,
        'texts', jsonb_build_object(
          'en', jsonb_build_object('title', 'Missed dose', 'body', v_en),
          'ar', jsonb_build_object('title', 'جرعة ما اتأكدتش', 'body', v_ar)),
        'exclude_roles', jsonb_build_array('family', 'doctor'),
        'extra_data', jsonb_build_object('event_id', v_e.id),
        'ttl_seconds', 21600));
    exception when others then
      raise warning 'salem: missed-dose push failed for event %: %', v_e.id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.expire_stale_reminder_events() from public, anon, authenticated;

-- ── Rafiq's check-in to the elder (live body = step32j) ──────────────────────────
create or replace function public.dispatch_rafiq_checkins(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cfg     jsonb := coalesce((select value from public.app_config where key = 'rafiq_chat'), '{}'::jsonb);
  v_max     int   := least(3, greatest(0, coalesce((v_cfg->>'max_checkins')::int, 3)));
  v_qs      int   := coalesce(public._hhmm_minutes(v_cfg->>'quiet_start'), 22 * 60);
  v_qe      int   := coalesce(public._hhmm_minutes(v_cfg->>'quiet_end'), 8 * 60);
  v_sent    int   := 0;
  e         record;
  v_slot    text;
  v_slot_m  int;
  v_now_m   int;
  v_quiet   boolean;
  v_part    text;
  v_en      text;
  v_ar      text;
begin
  if not coalesce((v_cfg->>'enabled')::boolean, true)
     or not coalesce((v_cfg->>'checkin_push')::boolean, false) then
    return 0;
  end if;

  for e in
    select p.id,
           nullif(split_part(trim(coalesce(p.display_name, '')), ' ', 1), '') as me,
           case when p.timezone is not null and exists (select 1 from pg_timezone_names z where z.name = p.timezone)
                then p.timezone else 'Africa/Cairo' end as tz
      from public.profiles p
     where p.role = 'elder'
       and exists (select 1 from public.care_circles c where c.elder_id = p.id)
       and exists (select 1 from public.push_tokens t where t.user_id = p.id)
       and not exists (select 1 from public.rafiq_activity a
                        where a.elder_id = p.id and a.last_at > p_now - interval '3 hours')
  loop
    v_now_m := extract(hour from p_now at time zone e.tz)::int * 60 + extract(minute from p_now at time zone e.tz)::int;
    v_quiet := case when v_qs > v_qe then v_now_m >= v_qs or v_now_m < v_qe
                    else v_now_m >= v_qs and v_now_m < v_qe end;
    continue when v_quiet;
    continue when (select count(*) from public.rafiq_checkin_pushes k
                    where k.elder_id = e.id and k.local_day = (p_now at time zone e.tz)::date) >= v_max;

    -- The latest slot that has started in the last 30 minutes.
    select s, public._hhmm_minutes(s) into v_slot, v_slot_m
      from jsonb_array_elements_text(coalesce(v_cfg->'checkin_times', '["10:00","19:00"]'::jsonb)) s
     where public._hhmm_minutes(s) between v_now_m - 29 and v_now_m
     order by public._hhmm_minutes(s) desc
     limit 1;
    continue when v_slot is null;

    insert into public.rafiq_checkin_pushes (elder_id, local_day, slot, sent_at)
    values (e.id, (p_now at time zone e.tz)::date, v_slot, p_now)
    on conflict do nothing;
    continue when not found;

    v_part := case when v_slot_m < 15 * 60 then 'checkin_morning' else 'checkin_evening' end;
    v_en := public._rafiq_fill(coalesce(public._rafiq_pick(v_part, 'en'),
              case when v_part = 'checkin_morning' then 'Good morning, {me}! How are you feeling?'
                   else 'Good evening, {me}! How was your day?' end), e.me, null, null);
    v_ar := public._rafiq_fill(coalesce(public._rafiq_pick(v_part, 'ar'),
              case when v_part = 'checkin_morning' then 'صباح الخير يا {me}! عامل إيه النهارده؟'
                   else 'مساء الخير يا {me}! يومك كان عامل إزاي؟' end), e.me, null, null);

    begin
      perform public._post_edge('notify-fanout', jsonb_build_object(
        'elder_id', e.id,
        'recipients', 'elder',
        'severity', 'info',
        'source_kind', 'rafiq',
        'source_id', null,
        'title_ar', 'رفيق',
        'body_ar', v_ar,
        'texts', jsonb_build_object(
          'en', jsonb_build_object('title', 'Rafiq', 'body', v_en),
          'ar', jsonb_build_object('title', 'رفيق', 'body', v_ar)),
        'extra_data', jsonb_build_object('kind', 'checkin', 'slot', v_slot),
        'ttl_seconds', 7200));
      v_sent := v_sent + 1;
    exception when others then
      raise warning 'salem: check-in push failed for %: %', e.id, sqlerrm;
    end;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.dispatch_rafiq_checkins(timestamptz) from public, anon, authenticated;

-- ── SOS / fall location follow-up (live body = step29b) ──────────────────────────
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
    'title_ar', 'تحديث الموقع: ' || v_what_ar,
    'body_ar', 'مكان ' || v_name || ' الآن.',
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
