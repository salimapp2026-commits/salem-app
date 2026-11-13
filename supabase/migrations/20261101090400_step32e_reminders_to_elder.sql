-- step32e — medicine reminders to the elder's own phone, in Rafiq's voice (founder,
-- 2026-11-01). Safe to apply twice.
--
-- What was wrong (found 2026-11-01 on the test elder):
--   • dispatch_due_reminders runs every minute and never skipped a dose it had already
--     sent: each dose went out once a minute until it was marked missed an hour later
--     (this morning: Concor 61 times, Glucophage 60). Nobody received them only because
--     no phone had a push token yet.
--   • reminders went to caregivers (get_alert_recipients), never to the elder.
--   • "remind me" (snoozed) was never reminded again, and never became missed.
--   • the push log failed silently for reminders (an event id is not a uuid).
--
-- Now:
--   • each dose is sent ONCE at its time, to the ELDER only (notify-fanout v6,
--     recipients 'elder'), in Rafiq's voice (rafiq_lines 'reminder_dose', seeded here
--     from the app's reviewable lines file), with three buttons: Taken / Not yet / Later.
--   • Taken → done. Not yet → reminded again after not_yet_minutes. Later (and the elder
--     card's "remind me") → after later_minutes. At most max_reminders pushes per dose.
--   • missed → missed_after_minutes after the last reminder, if still unanswered.
--   • a dose more than 30 minutes late (the server was down) is not sent late.
--   • caregivers no longer get a push per dose; they see adherence on their home.
-- Timings are in app_config 'reminders'; change them there.

-- ── Settings ────────────────────────────────────────────────────────────────
insert into public.app_config (key, value, description) values (
  'reminders',
  '{"not_yet_minutes": 15, "later_minutes": 60, "max_reminders": 3, "missed_after_minutes": 60}'::jsonb,
  'Medicine reminders to the elder: not_yet_minutes / later_minutes until the next reminder, at most max_reminders pushes per dose, missed after missed_after_minutes without an answer'
) on conflict (key) do nothing;

create or replace function public._reminder_cfg(p_key text, p_default int)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select (value->>p_key)::int from public.app_config where key = 'reminders'), p_default);
$$;
revoke all on function public._reminder_cfg(text, int) from public, anon;
-- Signed-in users need it: answering a dose reads the snooze times (nothing secret).
grant execute on function public._reminder_cfg(text, int) to authenticated;

-- ── Event bookkeeping ───────────────────────────────────────────────────────
alter table public.reminder_events
  add column if not exists dispatched_at timestamptz,
  add column if not exists reminders_sent smallint not null default 0,
  add column if not exists next_reminder_at timestamptz;

-- ── Rafiq's reminder lines on the server ────────────────────────────────────
insert into public.rafiq_lines (category, lang, text)
select 'reminder_dose', l.lang, l.text
  from (values ('en', 'Time for your {med} ({time}). Shall we take it now?'),
         ('en', '{me}, it’s {time} — your {med} is waiting for you.'),
         ('en', 'A gentle reminder: {med} at {time}.'),
         ('en', 'Your {med} is due ({time}). A glass of water and done!'),
         ('en', 'It’s time for {med}. Your health thanks you.'),
         ('en', '{med} o’clock! ({time}) Shall we?'),
         ('en', 'Don’t let the {med} feel forgotten — it’s {time}.'),
         ('en', 'Reminder from your friend Rafiq: {med}, {time}.'),
         ('en', '{me}, your {med} is due now ({time}).'),
         ('en', 'Medicine time: {med} at {time}.'),
         ('en', 'Just like clockwork — {med} at {time}.'),
         ('en', 'Your {med} has been waiting since {time}.'),
         ('en', 'A small pill, a big favour to yourself: {med} ({time}).'),
         ('en', 'It’s {time}. Time for {med}, please.'),
         ('en', 'Have you got your {med} nearby? It’s due ({time}).'),
         ('ar', 'ميعاد {med} (الساعة {time}). ناخده دلوقتي؟'),
         ('ar', 'يا {me}، الساعة {time} — {med} مستنيك.'),
         ('ar', 'تذكير صغير: {med} الساعة {time}.'),
         ('ar', 'ميعاد {med} جه ({time}). كوباية مية وخلصنا!'),
         ('ar', 'ميعاد {med}. صحتك هتشكرك.'),
         ('ar', 'ساعة {med}! ({time}) يلا بينا؟'),
         ('ar', 'ما تخليش {med} يزعل إنك نسيته — الساعة {time}.'),
         ('ar', 'تذكير من صاحبك رفيق: {med}، الساعة {time}.'),
         ('ar', 'يا {me}، ميعاد {med} دلوقتي ({time}).'),
         ('ar', 'ميعاد الدوا: {med} الساعة {time}.'),
         ('ar', 'زي الساعة بالظبط — {med} الساعة {time}.'),
         ('ar', '{med} مستنيك من الساعة {time}.'),
         ('ar', 'حباية صغيرة، وجميل كبير لنفسك: {med} ({time}).'),
         ('ar', 'الساعة {time}. ميعاد {med} من فضلك.'),
         ('ar', '{med} جنبك؟ ميعاده جه ({time}).')) as l(lang, text)
 where not exists (select 1 from public.rafiq_lines x where x.category = 'reminder_dose');

-- One line, placeholders filled the way the app does (lib/rafiqChat/engine.ts line()):
-- a missing {me} drops the name with its comma or "يا".
create or replace function public._rafiq_fill(p_text text, p_me text, p_med text, p_time text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    case when coalesce(p_me, '') = ''
         then regexp_replace(p_text, ',?\s*(يا\s*)?\{me\}', '', 'g')
         else replace(p_text, '{me}', p_me) end,
    '\{med\}', coalesce(p_med, ''), 'g'),
    '\{time\}', coalesce(p_time, ''), 'g'),
    '\s+([!?.،؟])', '\1', 'g'),
    '^[\s,،]+', ''));
$$;

create or replace function public._rafiq_pick(p_category text, p_lang text)
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select l.text from public.rafiq_lines l
   where l.category = p_category and l.lang = p_lang and l.active
   order by random() limit 1;
$$;
revoke all on function public._rafiq_pick(text, text) from public, anon, authenticated;

-- ── Sending ─────────────────────────────────────────────────────────────────
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
        'title_ar', 'Rafiq',
        'body_ar', v_en,
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

-- ── Answers ─────────────────────────────────────────────────────────────────
-- Not yet → again after not_yet_minutes (still pending); Later → after later_minutes
-- (snoozed). Same permission as answering a dose: the elder or read-health members.
create or replace function public.reminder_snooze(p_event_id bigint, p_kind text)
returns public.reminder_events
language plpgsql
set search_path to 'public'
as $$
declare
  v_row public.reminder_events;
  v_min int;
begin
  if p_kind not in ('not_yet', 'later') then
    raise exception 'invalid snooze' using errcode = '22023';
  end if;
  v_min := case p_kind when 'not_yet' then public._reminder_cfg('not_yet_minutes', 15)
                       else public._reminder_cfg('later_minutes', 60) end;
  update public.reminder_events e
     set status = case p_kind when 'later' then 'snoozed'::public.reminder_event_status else 'pending'::public.reminder_event_status end,
         next_reminder_at = now() + make_interval(mins => v_min)
    from public.reminders r
   where e.id = p_event_id
     and r.id = e.reminder_id
     and e.status in ('pending', 'snoozed')
     and public.has_perm(r.elder_id, 'health')
   returning e.* into v_row;
  if not found then
    raise exception 'reminder event not found, already answered, or no permission' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;
revoke all on function public.reminder_snooze(bigint, text) from public, anon;
grant execute on function public.reminder_snooze(bigint, text) to authenticated;

-- Older apps answer "remind me" with reminder_event_respond('snoozed'): give it a time.
create or replace function public.reminder_event_respond(p_event_id bigint, p_status public.reminder_event_status, p_notes text default null)
returns public.reminder_events
language plpgsql
set search_path to 'public'
as $$
declare
  v_row public.reminder_events;
begin
  if p_status not in ('done','skipped','snoozed') then
    raise exception 'invalid response status' using errcode = '22023';
  end if;

  update public.reminder_events e
     set status = p_status,
         responded_at = now(),
         responded_by = auth.uid(),
         notes = coalesce(p_notes, e.notes),
         next_reminder_at = case when p_status = 'snoozed'                       -- step32e
                                 then now() + make_interval(mins => public._reminder_cfg('later_minutes', 60))
                                 else e.next_reminder_at end
    from public.reminders r
   where e.id = p_event_id
     and r.id = e.reminder_id
     and public.has_perm(r.elder_id, 'health')
   returning e.* into v_row;

  if not found then
    raise exception 'reminder event not found or no permission' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- ── Missed ──────────────────────────────────────────────────────────────────
create or replace function public.expire_stale_reminder_events()
returns integer
language sql
security definer
set search_path to 'public'
as $$
  with upd as (
    update public.reminder_events
       set status = 'missed'
     where status in ('pending', 'snoozed')
       and coalesce(next_reminder_at, scheduled_at)
           < now() - make_interval(mins => public._reminder_cfg('missed_after_minutes', 60))
     returning 1
  )
  select count(*)::int from upd;
$$;

-- Check (read-only): each future dose of the test elder, never sent yet.
-- select e.id, r.title, e.scheduled_at at time zone 'Africa/Cairo' cairo, e.status, e.reminders_sent, e.dispatched_at
--   from public.reminder_events e join public.reminders r on r.id = e.reminder_id
--  where e.elder_id = '7e57c0c0-0000-4000-a000-000000000001' order by e.scheduled_at desc limit 6;
