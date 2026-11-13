-- step32f — ONE push to the primary caretaker when a medicine dose becomes missed
-- (founder, 2026-11-01). Safe to apply twice. Needs step32e.
--
-- Caregivers no longer get a push for every dose (step32e). Instead, when a dose is
-- still unanswered after all the elder's reminders and becomes "missed", the primary
-- caretaker gets one push, in plain words, at normal urgency (not SOS):
--   "Mona hasn't confirmed taking Concor 5 mg (08:00). You may want to check in."
--
-- Who: get_alert_recipients at 'info' — active primary caretakers who can read health.
-- Never doctors, never other family members. No primary caretaker → nobody.
-- Once per dose: reminder_events.missed_notified_at is set in the same statement that
-- marks it missed. A dose missed more than 6 hours ago (the server was down) is marked
-- but not pushed late.
--
-- Switch: app_config 'reminders' → "missed_notify_primary" (true/false). Off:
--   update public.app_config set value = value || '{"missed_notify_primary": false}'
--    where key = 'reminders';

-- ── Setting ─────────────────────────────────────────────────────────────────
update public.app_config
   set value = value || '{"missed_notify_primary": true}'::jsonb,
       description = 'Medicine reminders to the elder: not_yet_minutes / later_minutes until the next reminder, at most max_reminders pushes per dose, missed after missed_after_minutes without an answer; missed_notify_primary: one push to the primary caretaker when a dose is missed'
 where key = 'reminders' and not (value ? 'missed_notify_primary');

alter table public.reminder_events add column if not exists missed_notified_at timestamptz;

-- ── Missed ──────────────────────────────────────────────────────────────────
-- Was language sql (step32e); same name, same result: how many became missed. The
-- cron job (every 5 minutes) keeps calling it; its grants are kept.
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

-- Check (read-only): the switch, and the last missed doses with whether they were pushed.
-- select value->'missed_notify_primary' from public.app_config where key = 'reminders';
-- select e.id, r.title, e.scheduled_at at time zone 'Africa/Cairo' cairo, e.status, e.missed_notified_at
--   from public.reminder_events e join public.reminders r on r.id = e.reminder_id
--  where e.status = 'missed' order by e.scheduled_at desc limit 6;
