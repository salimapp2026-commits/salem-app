-- step32i — add and stop medicines from the app (founder, 2026-11-04). Safe to apply
-- twice. Needs step32e (reminders to the elder).
--
-- Until now a medicine reminder could only be made on the server. Now the elder and
-- their PRIMARY CARETAKER add one in the app: a name, an optional dose, one or more
-- times of day. Each time is one daily reminder (reminders.local_time, elder's time
-- zone). Nobody else may add, change or stop a reminder — not family members, not
-- doctors (founder, 2026-11-04). Everyone in the circle may still read them.
--
--   add_medicine(elder, name, dose, times[])  → the new reminders' ids
--   stop_medicine(reminder)                    → no more reminders for it; its open
--                                                doses close quietly (skipped)
--
-- A new medicine's next dose is created at once, so a dose ten minutes away is not
-- lost waiting for the 15-minute materialize job.

-- ── Who may change medicines ────────────────────────────────────────────────
create or replace function public.can_manage_medicines(p_elder_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_elder_id = auth.uid()
      or exists (
        select 1
          from public.care_circle_members m
          join public.care_circles c on c.id = m.circle_id
         where c.elder_id = p_elder_id
           and m.user_id = auth.uid()
           and m.status = 'active'
           and m.member_role = 'primary_caretaker');
$$;
revoke all on function public.can_manage_medicines(uuid) from public, anon;
grant execute on function public.can_manage_medicines(uuid) to authenticated;

-- Reading stays as it was (the elder and anyone active in the circle); writing is
-- the elder and the primary caretaker only.
drop policy if exists reminders_rw on public.reminders;
drop policy if exists reminders_read on public.reminders;
drop policy if exists reminders_insert on public.reminders;
drop policy if exists reminders_update on public.reminders;
drop policy if exists reminders_delete on public.reminders;
create policy reminders_read on public.reminders for select
  using (elder_id = auth.uid() or public.is_in_circle(elder_id));
create policy reminders_insert on public.reminders for insert
  with check (public.can_manage_medicines(elder_id));
create policy reminders_update on public.reminders for update
  using (public.can_manage_medicines(elder_id))
  with check (public.can_manage_medicines(elder_id));
create policy reminders_delete on public.reminders for delete
  using (public.can_manage_medicines(elder_id));

-- ── Add ─────────────────────────────────────────────────────────────────────
create or replace function public.add_medicine(
  p_elder_id uuid,
  p_name     text,
  p_dose     text,
  p_times    time[]
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_dose  text := nullif(btrim(coalesce(p_dose, '')), '');
  v_title text;
  v_times time[];
  v_t     time;
  v_id    uuid;
  v_next  timestamptz;
  v_ids   uuid[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_elder_id is null or not public.can_manage_medicines(p_elder_id) then
    raise exception 'no permission' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if v_dose is not null and length(v_dose) > 40 then
    raise exception 'invalid dose' using errcode = '22023';
  end if;
  -- Whole minutes, each time once, at most 6 a day.
  select array_agg(distinct date_trunc('minute', t)::time order by date_trunc('minute', t)::time)
    into v_times
    from unnest(coalesce(p_times, '{}')) t
   where t is not null;
  if v_times is null or cardinality(v_times) = 0 or cardinality(v_times) > 6 then
    raise exception 'invalid times' using errcode = '22023';
  end if;

  v_title := v_name || coalesce(' ' || v_dose, '');
  foreach v_t in array v_times loop
    insert into public.reminders (elder_id, kind, title, local_time, active, created_by)
    values (p_elder_id, 'medication', v_title, v_t, true, auth.uid())
    returning id into v_id;
    v_ids := v_ids || v_id;

    v_next := public._reminder_next_local_time_run(p_elder_id, v_t, now());
    insert into public.reminder_events (reminder_id, elder_id, scheduled_at, status)
    values (v_id, p_elder_id, v_next, 'pending');
  end loop;
  return v_ids;
end;
$$;
revoke all on function public.add_medicine(uuid, text, text, time[]) from public, anon;
grant execute on function public.add_medicine(uuid, text, text, time[]) to authenticated;

-- ── Stop ────────────────────────────────────────────────────────────────────
create or replace function public.stop_medicine(p_reminder_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_elder uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select elder_id into v_elder
    from public.reminders where id = p_reminder_id and kind = 'medication';
  if v_elder is null or not public.can_manage_medicines(v_elder) then
    raise exception 'no permission' using errcode = '42501';
  end if;

  update public.reminders set active = false where id = p_reminder_id;
  -- Its open doses, today's and the next one, close quietly: no reminder, never
  -- "missed", no push to the family.
  update public.reminder_events
     set status = 'skipped', next_reminder_at = null
   where reminder_id = p_reminder_id
     and status in ('pending', 'snoozed');
end;
$$;
revoke all on function public.stop_medicine(uuid) from public, anon;
grant execute on function public.stop_medicine(uuid) to authenticated;

-- Check (read-only): the policies, and who may manage whose medicines.
-- select polname, polcmd::text from pg_policy where polrelid = 'public.reminders'::regclass;
--   → reminders_read r, reminders_insert a, reminders_update w, reminders_delete d
