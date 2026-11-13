-- step32a — Rafiq's chat, phase 1: settings and lines on the server, mood, the crisis
-- alert, and an "elder talked to Rafiq" marker. No chat text ever reaches the server:
-- conversations stay on the phone (founder, 4g). Only these do:
--
--   app_config 'rafiq_chat'   chat settings the app reads at start (check-in times, quiet
--                             hours, at most 3 check-ins a day, crisis words, help numbers,
--                             an on/off switch). The app has the same values built in
--                             (native/src/lib/rafiqChat/lines.ts) and uses them offline
--                             or if this row is missing. Edit the row to change them
--                             without a new APK.
--   rafiq_lines               Rafiq's lines. Empty = the built-in lines. Add active rows
--                             for a category + language to replace that category.
--   elder_moods               one mood a day (1 low · 2 okay · 3 good), from the three
--                             faces. Readable by the elder and by caregivers with the
--                             health permission — never by doctors.
--   raise_crisis_alert()      the elder's message had a crisis word: an urgent alert to
--                             the caregivers (never doctors), with the last known location
--                             for those allowed it — never the words. At most one push per
--                             30 minutes.
--   rafiq_touch()             when the elder last talked to Rafiq (for the server's
--                             check-in pushes, later). Nobody else can read it.
--
-- HELP NUMBERS ARE PLACEHOLDERS until the founder confirms them (edit the row's
-- help_numbers, and the built-in copy before the release build).
-- Safe to apply twice.

-- ── Settings ────────────────────────────────────────────────────────────────
create table if not exists public.app_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to authenticated;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to authenticated using (true);

insert into public.app_config (key, value, description) values (
  'rafiq_chat',
  $json${
  "enabled": true,
  "checkin_times": [
    "10:00",
    "19:00"
  ],
  "quiet_start": "22:00",
  "quiet_end": "08:00",
  "max_checkins": 3,
  "crisis_words": {
    "en": [
      "want to die",
      "wanna die",
      "wish i was dead",
      "wish i were dead",
      "kill myself",
      "end my life",
      "end it all",
      "suicide",
      "suicidal",
      "hurt myself",
      "harm myself",
      "cut myself",
      "dont want to live",
      "don’t want to live",
      "no reason to live",
      "better off dead",
      "take my own life"
    ],
    "ar": [
      "عايز اموت",
      "عاوز اموت",
      "عايزه اموت",
      "عاوزه اموت",
      "نفسي اموت",
      "اريد ان اموت",
      "اتمني الموت",
      "اموت نفسي",
      "اقتل نفسي",
      "انتحر",
      "انتحار",
      "انهي حياتي",
      "اخلص من حياتي",
      "اؤذي نفسي",
      "اذي نفسي",
      "مش عايز اعيش",
      "مش عاوز اعيش",
      "مش عايزه اعيش",
      "مش عاوزه اعيش",
      "مليش لازمه",
      "احسن لو مت"
    ]
  },
  "help_numbers": [
    {
      "label": {
        "en": "Emergency (ambulance)",
        "ar": "الإسعاف"
      },
      "phone": "123"
    },
    {
      "label": {
        "en": "Mental-health helpline (TO CONFIRM)",
        "ar": "خط الدعم النفسي (للتأكيد)"
      },
      "phone": "00000"
    }
  ]
}$json$::jsonb,
  'Rafiq chat: enabled, checkin_times (local HH:MM), quiet_start/quiet_end, max_checkins (≤3), crisis_words {en,ar}, help_numbers [{label:{en,ar}, phone}]'
) on conflict (key) do nothing;

-- ── Lines ───────────────────────────────────────────────────────────────────
create table if not exists public.rafiq_lines (
  id         bigserial primary key,
  category   text not null,
  lang       text not null check (lang in ('ar', 'en')),
  text       text not null check (length(trim(text)) > 0),
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists rafiq_lines_category on public.rafiq_lines (category, lang) where active;
alter table public.rafiq_lines enable row level security;
revoke all on public.rafiq_lines from anon, authenticated;
grant select on public.rafiq_lines to authenticated;
drop policy if exists rafiq_lines_read on public.rafiq_lines;
create policy rafiq_lines_read on public.rafiq_lines for select to authenticated using (active);

-- ── Mood ────────────────────────────────────────────────────────────────────
create table if not exists public.elder_moods (
  elder_id   uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  mood       smallint not null check (mood between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (elder_id, day)
);
alter table public.elder_moods enable row level security;
revoke all on public.elder_moods from anon, authenticated;
grant select on public.elder_moods to authenticated;

-- Caregivers with the health permission; never doctors. Security definer so the policy
-- never queries care_circle_members under its own RLS.
create or replace function public._can_read_mood(p_elder uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_elder = auth.uid() or exists (
    select 1
    from public.care_circle_members m
    join public.care_circles c on c.id = m.circle_id
    where c.elder_id = p_elder
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.can_read_health
      and m.member_role in ('primary_caretaker', 'family')
  );
$$;
revoke all on function public._can_read_mood(uuid) from public, anon;
grant execute on function public._can_read_mood(uuid) to authenticated;

drop policy if exists elder_moods_read on public.elder_moods;
create policy elder_moods_read on public.elder_moods for select to authenticated
  using (public._can_read_mood(elder_id));

-- The elder records today's mood (their own local date); a second tap the same day
-- replaces it.
create or replace function public.record_mood(p_mood smallint, p_day date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.care_circles where elder_id = v_uid) then
    raise exception 'elders_only' using errcode = '42501';
  end if;
  if p_mood is null or p_mood not between 1 and 3 then
    raise exception 'bad_mood' using errcode = '22023';
  end if;
  if p_day is null or p_day not between current_date - 1 and current_date + 1 then
    raise exception 'bad_day' using errcode = '22023';
  end if;
  insert into public.elder_moods (elder_id, day, mood) values (v_uid, p_day, p_mood)
  on conflict (elder_id, day) do update set mood = excluded.mood, updated_at = now();
end;
$$;
revoke all on function public.record_mood(smallint, date) from public, anon;
grant execute on function public.record_mood(smallint, date) to authenticated;

-- ── "Talked to Rafiq" ───────────────────────────────────────────────────────
create table if not exists public.rafiq_activity (
  elder_id uuid primary key references public.profiles(id) on delete cascade,
  last_at  timestamptz not null
);
alter table public.rafiq_activity enable row level security;
revoke all on public.rafiq_activity from anon, authenticated;
grant select on public.rafiq_activity to authenticated;
drop policy if exists rafiq_activity_own on public.rafiq_activity;
create policy rafiq_activity_own on public.rafiq_activity for select to authenticated
  using (elder_id = auth.uid());

create or replace function public.rafiq_touch()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.care_circles where elder_id = auth.uid()) then
    return;
  end if;
  insert into public.rafiq_activity (elder_id, last_at) values (auth.uid(), now())
  on conflict (elder_id) do update set last_at = now();
end;
$$;
revoke all on function public.rafiq_touch() from public, anon;
grant execute on function public.rafiq_touch() to authenticated;

-- ── Crisis ──────────────────────────────────────────────────────────────────
-- An SOS-urgency alert row (kind 'sos', payload source 'rafiq_chat') with no words in
-- it, and its own push: caregivers only (exclude doctors), fixed text, the last known
-- location for those allowed it. Returns the alert id (an earlier one within 30 minutes
-- is returned instead of pushing again).
create or replace function public.raise_crisis_alert()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.health_alerts;
  v_id   uuid;
  v_name text;
  v_loc  jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.care_circles where elder_id = v_uid) then
    raise exception 'elders_only' using errcode = '42501';
  end if;

  select a.id into v_id
  from public.health_alerts a
  where a.elder_id = v_uid
    and a.kind = 'sos'
    and a.payload->>'source' = 'rafiq_chat'
    and a.created_at > now() - interval '30 minutes'
  order by a.created_at desc
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.health_alerts (elder_id, kind, severity, payload)
  values (v_uid, 'sos', 'critical',
          jsonb_build_object('source', 'rafiq_chat', 'reason', 'crisis', 'no_fanout', true, 'raised_by', v_uid))
  returning * into v_row;

  -- Wrapped: a push failure never undoes the alert row.
  begin
    select coalesce(nullif(split_part(trim(coalesce(display_name, '')), ' ', 1), ''), 'Your family member')
      into v_name from public.profiles where id = v_uid;
    v_loc := public._emergency_location(v_row.id, v_uid);
    perform public._post_edge('notify-fanout', jsonb_build_object(
      'elder_id', v_uid,
      'severity', 'critical',
      'source_kind', 'sos',
      'source_id', v_row.id,
      'exclude_roles', jsonb_build_array('doctor'),
      'title_ar', v_name || ' may need you now',
      'body_ar', v_name || ' said something worrying to Rafiq. Please call them now.',
      'texts', jsonb_build_object(
        'en', jsonb_build_object('title', v_name || ' may need you now',
                                 'body', v_name || ' said something worrying to Rafiq. Please call them now.'),
        'ar', jsonb_build_object('title', v_name || ' محتاجك دلوقتي',
                                 'body', v_name || ' قال لرفيق كلام مقلق. من فضلك اتصل بيه دلوقتي.')),
      'location', v_loc));
  exception when others then
    raise warning 'salem: crisis push failed for alert %: %', v_row.id, sqlerrm;
  end;
  return v_row.id;
end;
$$;
revoke all on function public.raise_crisis_alert() from public, anon;
grant execute on function public.raise_crisis_alert() to authenticated;

-- Check (read-only):
-- select key, value->'checkin_times', jsonb_array_length(value->'help_numbers') from public.app_config;
-- select count(*) from public.rafiq_lines;
-- select proname from pg_proc where proname in ('record_mood','raise_crisis_alert','rafiq_touch','_can_read_mood');
