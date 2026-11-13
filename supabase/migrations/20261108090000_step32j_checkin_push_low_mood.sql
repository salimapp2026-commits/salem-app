-- step32j — Rafiq's check-in as a push to the elder, and a low-mood notice to the
-- family (beta plan item 1, founder 2026-10-31 / 2026-11-01). Safe to apply twice.
-- Needs step32a (Rafiq chat), step32e (_rafiq_pick / _rafiq_fill), step32g (log kinds).
--
-- CHECK-IN PUSH (switch: app_config 'rafiq_chat' → "checkin_push", OFF by default)
--   At each check-in time (rafiq_chat.checkin_times, elder's local time, 10:00 and
--   19:00), Rafiq says hello on the elder's phone with one of his morning / evening
--   lines — only if: not in quiet hours (22:00–08:00), the elder hasn't talked to Rafiq
--   in the last 3 hours, fewer than max_checkins (≤ 3) went out today, the elder has a
--   phone that takes pushes. Each time slot at most once a day; a slot more than 30
--   minutes late (server down) is skipped, never sent late.
--   Off by default: in the APK the families have (0.9.1-beta), tapping a push opens the
--   elder's notifications, not the Rafiq chat. Turn it on with the next APK:
--     update public.app_config set value = value || '{"checkin_push": true}' where key = 'rafiq_chat';
--
-- LOW-MOOD NOTICE (switch: "low_mood_notify", ON)
--   When the elder taps the "Not good" face (mood 1), the family members who may see their
--   health — primary caretaker and family with the health permission, never doctors —
--   get ONE plain push that day, normal urgency:
--     "Mona answered "Not good" to today's mood question. You may want to call and check in."
--   Changing the mood again the same day sends nothing more. No words from the chat
--   are ever sent — only that the face was tapped.

-- ── Settings ────────────────────────────────────────────────────────────────
update public.app_config
   set value = value || '{"checkin_push": false}'::jsonb
 where key = 'rafiq_chat' and not (value ? 'checkin_push');
update public.app_config
   set value = value || '{"low_mood_notify": true}'::jsonb
 where key = 'rafiq_chat' and not (value ? 'low_mood_notify');

-- ── Check-ins sent ──────────────────────────────────────────────────────────
create table if not exists public.rafiq_checkin_pushes (
  elder_id  uuid not null references public.profiles(id) on delete cascade,
  local_day date not null,
  slot      text not null,              -- "10:00"
  sent_at   timestamptz not null default now(),
  primary key (elder_id, local_day, slot)
);
alter table public.rafiq_checkin_pushes enable row level security;
revoke all on public.rafiq_checkin_pushes from anon, authenticated;

-- "HH:MM" → minutes after midnight; null when it isn't a time.
create or replace function public._hhmm_minutes(p text)
returns int
language sql
immutable
as $$
  select case when p ~ '^\d{1,2}:\d{2}$'
              then split_part(p, ':', 1)::int * 60 + split_part(p, ':', 2)::int end;
$$;

-- p_now only for tests; the cron job passes nothing.
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
        'title_ar', 'Rafiq',
        'body_ar', v_en,
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

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'salem_rafiq_checkins';
    perform cron.schedule('salem_rafiq_checkins', '*/5 * * * *', $c$ select public.dispatch_rafiq_checkins(); $c$);
  end if;
end;
$$;

-- ── Low mood ────────────────────────────────────────────────────────────────
alter table public.elder_moods add column if not exists low_notified_at timestamptz;

create or replace function public._notify_low_mood()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_on   boolean := coalesce((select (value->>'low_mood_notify')::boolean
                                from public.app_config where key = 'rafiq_chat'), true);
  v_name text;
  v_en   text;
  v_ar   text;
begin
  if not v_on or new.mood <> 1 or new.low_notified_at is not null
     or (tg_op = 'UPDATE' and old.mood = 1)
     or new.day < current_date - 1 then
    return null;
  end if;
  -- Once a day: mark it first, so a second tap never sends again.
  update public.elder_moods set low_notified_at = now()
   where elder_id = new.elder_id and day = new.day and low_notified_at is null;
  if not found then
    return null;
  end if;

  select nullif(split_part(trim(coalesce(display_name, '')), ' ', 1), '') into v_name
    from public.profiles where id = new.elder_id;
  if v_name is null then
    v_en := 'Your family member answered "Not good" to today''s mood question. You may want to call and check in.';
    v_ar := 'الرد على سؤال المزاج النهارده: «مش بخير». ممكن تتصل تطمّن.';
  else
    v_en := v_name || ' answered "Not good" to today''s mood question. You may want to call and check in.';
    v_ar := 'رد ' || v_name || ' على سؤال المزاج النهارده: «مش بخير». ممكن تتصل تطمّن.';
  end if;

  begin
    perform public._post_edge('notify-fanout', jsonb_build_object(
      'elder_id', new.elder_id,
      'severity', 'warning',               -- primary caretaker + family with the health permission
      'source_kind', 'rafiq',
      'source_id', null,
      'title_ar', 'Mood today',
      'body_ar', v_en,
      'texts', jsonb_build_object(
        'en', jsonb_build_object('title', 'Mood today', 'body', v_en),
        'ar', jsonb_build_object('title', 'المزاج النهارده', 'body', v_ar)),
      'exclude_roles', jsonb_build_array('doctor'),
      'extra_data', jsonb_build_object('kind', 'low_mood'),
      'ttl_seconds', 43200));
  exception when others then
    raise warning 'salem: low-mood push failed for %: %', new.elder_id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public._notify_low_mood() from public, anon, authenticated;

drop trigger if exists elder_moods_low_notify on public.elder_moods;
create trigger elder_moods_low_notify
  after insert or update of mood on public.elder_moods
  for each row execute function public._notify_low_mood();

-- Check (read-only): the switches and the job.
-- select value->'checkin_push', value->'low_mood_notify' from public.app_config where key = 'rafiq_chat';
-- select jobname, schedule from cron.job where jobname = 'salem_rafiq_checkins';
