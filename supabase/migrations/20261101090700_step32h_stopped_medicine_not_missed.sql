-- step32h — a stopped medicine never causes a "Missed dose" push (found 2026-11-01).
-- Safe to apply twice. Needs step32f.
--
-- When a medicine is turned off, dispatch_due_reminders stops reminding the elder about
-- its open doses (it skips inactive reminders), but expire_stale_reminder_events still
-- marked them "missed" an hour later — and since step32f that pushes "Missed dose" to
-- the primary caretaker for a medicine that was stopped. Now those doses are closed as
-- skipped, silently. Everything else is exactly step32f.

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
        'title_ar', 'Missed dose',
        'body_ar', v_en,
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
