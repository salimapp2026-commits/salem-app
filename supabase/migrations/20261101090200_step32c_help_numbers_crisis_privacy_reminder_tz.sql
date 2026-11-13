-- step32c — three fixes (founder, 2026-11-01). Safe to apply twice.
--
-- 1. Crisis help numbers confirmed: ambulance 123; mental-health support 16328 (Ministry
--    of Health, General Secretariat of Mental Health, 24/7 — the founder called it).
--    The app's built-in copy (native/src/lib/rafiqChat/lines.ts) says the same.
--
-- 2. Crisis alerts are hidden from doctors: an alert raised by Rafiq's chat (payload
--    source 'rafiq_chat') is readable only by the elder and by caregivers with the
--    health permission — the same rule as mood (_can_read_mood). Restrictive policies,
--    so every path that reads alerts through row-level security (the alert lists,
--    recent_health_alerts) obeys them. The push already skipped doctors (step32a).
--
-- 3. Medicine reminders at the elder's own local time. _reminder_next_local_time_run
--    ignored profiles.timezone: Arabic accounts got Riyadh time, everyone else UTC — in
--    Cairo, 2 hours late (English) or 1 hour early (Arabic). It now uses the elder's
--    profiles.timezone (set from the phone at sign-up; every beta elder is
--    Africa/Cairo), and Africa/Cairo when that is missing or not a real time zone.
--    Future reminder events created at a wrong time and not answered yet are removed
--    and made again at the right time. Today only the Health Connect test elder has
--    reminders.

-- ── 1. Help numbers ─────────────────────────────────────────────────────────
update public.app_config
   set value = jsonb_set(value, '{help_numbers}', $json$[
         {"label": {"en": "Ambulance", "ar": "الإسعاف"}, "phone": "123"},
         {"label": {"en": "Mental health support (24/7)", "ar": "خط الدعم النفسي (24 ساعة)"}, "phone": "16328"}
       ]$json$::jsonb),
       updated_at = now()
 where key = 'rafiq_chat';

-- ── 2. Crisis alerts: caregivers only ───────────────────────────────────────
drop policy if exists alerts_crisis_select on public.health_alerts;
create policy alerts_crisis_select on public.health_alerts as restrictive for select to authenticated
  using (payload->>'source' is distinct from 'rafiq_chat' or public._can_read_mood(elder_id));
drop policy if exists alerts_crisis_update on public.health_alerts;
create policy alerts_crisis_update on public.health_alerts as restrictive for update to authenticated
  using (payload->>'source' is distinct from 'rafiq_chat' or public._can_read_mood(elder_id));

-- ── 3. Reminder times ───────────────────────────────────────────────────────
create or replace function public._reminder_next_local_time_run(p_elder_id uuid, p_local_time time without time zone, p_after timestamp with time zone)
returns timestamp with time zone
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_tz text;
  v_local_date date;
  v_candidate timestamptz;
begin
  select p.timezone into v_tz from public.profiles p where p.id = p_elder_id;
  if v_tz is null or not exists (select 1 from pg_timezone_names z where z.name = v_tz) then
    v_tz := 'Africa/Cairo';
  end if;

  v_local_date := (p_after at time zone v_tz)::date;
  v_candidate := ((v_local_date::text || ' ' || p_local_time::text)::timestamp at time zone v_tz);
  if v_candidate <= p_after then
    v_candidate := (((v_local_date + 1)::text || ' ' || p_local_time::text)::timestamp at time zone v_tz);
  end if;
  return v_candidate;
end;
$$;

-- Unanswered future events at the wrong local time → removed, then made again.
delete from public.reminder_events e
 using public.reminders r, public.profiles p
 where r.id = e.reminder_id
   and p.id = e.elder_id
   and r.local_time is not null
   and e.status = 'pending'
   and e.responded_at is null
   and e.scheduled_at > now()
   and (e.scheduled_at at time zone
          (case when exists (select 1 from pg_timezone_names z where z.name = p.timezone) then p.timezone else 'Africa/Cairo' end)
       )::time <> r.local_time;

select public.materialize_reminder_events();

-- Check (read-only): the test elder's next doses, in Cairo time — expect 08:00, 12:00, 21:00
-- (each the next one after now, so some may be tomorrow).
-- select r.title, r.local_time, (e.scheduled_at at time zone 'Africa/Cairo') as cairo, e.status
--   from public.reminder_events e join public.reminders r on r.id = e.reminder_id
--  where e.elder_id = '7e57c0c0-0000-4000-a000-000000000001' and e.scheduled_at > now()
--  order by e.scheduled_at;
