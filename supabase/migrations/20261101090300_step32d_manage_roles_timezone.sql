-- step32d — who may manage a circle, role changes, and the elder's time zone
-- (founder, 2026-11-01). Safe to apply twice.
--
-- 1. A family member who joins gets health and location but NOT "manage the circle".
--    Only the elder and the primary caretaker can add or remove members. Until now
--    every family member joined with can_manage_circle = true (redeem_link_code,
--    redeem_circle_invite and set_circle_member_role all gave it). Changed in all three;
--    only the primary caretaker can make a family code (create_link_code). Existing
--    family / doctor rows that have it are corrected (on 2026-11-01 that is only the
--    test caregiver test-healthconnect+newcarer, who joined during testing).
--
-- 2. set_circle_member_role did not check the person's account: a doctor account could
--    be switched to "family" and get location. A role change now has to fit the
--    account's permanent role, the same rule as codes (_link_role_ok, step32b).
--
-- 3. set_my_timezone(p_tz): the elder's own phone reports its time zone when the app
--    opens; the elder's profile is updated only if it changed, and that elder's future
--    unanswered reminder events are moved to the new local times. Only an elder, only
--    their own profile, only a real time zone. (An account created on a caregiver's
--    phone abroad — option A — corrects itself the first time the elder's phone opens
--    the app.) Missing or invalid zones already fall back to Africa/Cairo (step32c).

-- ── 1. Joining: family members never manage ────────────────────────────────
create or replace function public.create_link_code(p_role text, p_elder_id uuid default null)
returns table (code text, expires_at timestamptz, invite_id uuid, joins_as text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_account public.app_role;
  v_circle  uuid;
  v_member  public.circle_member_role;
  v_kind    text := 'member';
  v_code    text;
  v_id      uuid;
  v_expires timestamptz := now() + interval '15 minutes';
  v_try     int := 0;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select p.role into v_account from public.profiles p where p.id = v_uid;
  if v_account = 'doctor' then
    raise exception 'doctors_cannot_invite' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('caregiver', 'doctor', 'parent') then
    raise exception 'bad_role' using errcode = '22023';
  end if;

  if p_role = 'parent' then
    if v_account = 'elder' then
      raise exception 'bad_role' using errcode = '22023';
    end if;
    v_kind := 'parent';
    v_member := 'primary_caretaker';           -- what the code's MAKER becomes, decided again on redeem
  else
    if v_account = 'elder' then
      select c.id into v_circle from public.care_circles c where c.elder_id = v_uid;
    else
      select c.id into v_circle
      from public.care_circle_members m
      join public.care_circles c on c.id = m.circle_id
      where m.user_id = v_uid
        and m.status = 'active'
        and m.member_role = 'primary_caretaker'      -- step32d: only the primary caretaker adds members
        and m.can_manage_circle
        and (p_elder_id is null or c.elder_id = p_elder_id)
      order by m.created_at
      limit 1;
    end if;
    if v_circle is null then
      raise exception 'no_circle' using errcode = '42501';
    end if;
    v_member := case
      when p_role = 'doctor' then 'doctor'::public.circle_member_role
      when exists (select 1 from public.care_circle_members m
                   where m.circle_id = v_circle and m.status = 'active' and m.member_role = 'primary_caretaker')
        then 'family'::public.circle_member_role
      else 'primary_caretaker'::public.circle_member_role
    end;
  end if;

  -- Only the code on screen works; expired codes free up the 4-digit space.
  delete from public.care_circle_invites i
   where i.accepted_at is null and i.pair_code is not null
     and (i.invited_by = v_uid or i.pair_code_expires_at < now());

  loop
    v_try := v_try + 1;
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
    begin
      insert into public.care_circle_invites
        (circle_id, invited_by, member_role, expires_at, pair_code, pair_code_expires_at, link_kind)
      values (v_circle, v_uid, v_member, v_expires, v_code, v_expires, v_kind)
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_try >= 30 then
        raise exception 'could_not_allocate_code';
      end if;
    end;
  end loop;

  return query select v_code, v_expires, v_id,
    case when v_kind = 'parent' then 'parent' when v_member = 'doctor' then 'doctor' else 'caregiver' end;
end;
$$;

create or replace function public.redeem_link_code(p_code text)
returns table (status text, circle_id uuid, elder_id uuid, elder_name text, member_role public.circle_member_role)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  r        record;
  v_circle uuid;
  v_who    uuid;          -- who joins: the redeemer, or (parent code) the code's maker
  v_role   public.circle_member_role;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select * into r from public._check_link_code(p_code, v_uid, true);
  if r.status <> 'ok' then
    return query select r.status, null::uuid, null::uuid, null::text, null::public.circle_member_role;
    return;
  end if;

  if (r.invite).link_kind = 'parent' then
    select c.id into v_circle from public.care_circles c where c.elder_id = v_uid;
    v_who := (r.invite).invited_by;
    v_role := case when exists (select 1 from public.care_circle_members m
                                where m.circle_id = v_circle and m.status = 'active' and m.member_role = 'primary_caretaker')
                   then 'family'::public.circle_member_role else 'primary_caretaker'::public.circle_member_role end;
  else
    v_circle := (r.invite).circle_id;
    v_who := v_uid;
    v_role := (r.invite).member_role;
  end if;

  -- Only ever adds: an existing (e.g. removed) member is re-activated with the role and
  -- permissions they already had.
  insert into public.care_circle_members (
    circle_id, user_id, member_role,
    can_read_health, can_read_location, can_chat, can_call, can_manage_circle,
    status, invited_by
  ) values (
    v_circle, v_who, v_role,
    true,
    v_role in ('primary_caretaker', 'family'),
    true,
    true,
    v_role = 'primary_caretaker',                -- step32d: family members never manage the circle
    'active', (r.invite).invited_by
  )
  on conflict (circle_id, user_id)
  do update set status = 'active';

  update public.care_circle_invites i set accepted_at = now() where i.id = (r.invite).id;
  insert into public.pairing_attempts (user_id, succeeded) values (v_uid, true);

  return query
    select 'ok'::text, v_circle, c.elder_id, p.display_name, m.member_role
    from public.care_circles c
    join public.profiles p on p.id = c.elder_id
    join public.care_circle_members m on m.circle_id = c.id and m.user_id = v_who
    where c.id = v_circle;
end;
$$;

create or replace function public.redeem_circle_invite(p_token text)
returns table(r_circle_id uuid, r_elder_id uuid, r_elder_name text, r_member_role public.circle_member_role)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_invite public.care_circle_invites;
  v_elder_name text;
  v_circle_id uuid;
  v_elder_id uuid;
  v_role public.circle_member_role;
  v_account public.app_role;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_invite
  from public.care_circle_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'invite_not_found';
  end if;
  -- step32b: parent codes are redeemed only through redeem_link_code.
  if v_invite.link_kind = 'parent' then
    raise exception 'invite_not_found';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'invite_already_redeemed';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'invite_expired';
  end if;
  -- step32b: the invite's role must fit the account's permanent role.
  if not v_invite.for_new_elder then
    select p.role into v_account from public.profiles p where p.id = v_user;
    if v_account is null or not public._link_role_ok(v_account, v_invite.member_role) then
      raise exception 'wrong_role';
    end if;
  end if;

  if v_invite.for_new_elder then
    update public.profiles
      set role = 'elder',
          display_name = coalesce(nullif(display_name, ''), v_invite.elder_display_name, display_name)
      where id = v_user;

    select id into v_circle_id from public.care_circles where elder_id = v_user;
    if v_circle_id is null then
      insert into public.care_circles (elder_id, display_name)
      values (v_user, v_invite.elder_display_name)
      returning id into v_circle_id;
    end if;

    v_elder_id := v_user;
    v_role := 'primary_caretaker';

    if v_invite.invited_by is not null and v_invite.invited_by != v_user then
      insert into public.care_circle_members (
        circle_id, user_id, member_role,
        can_read_health, can_read_location, can_chat, can_call, can_manage_circle,
        status, invited_by
      ) values (
        v_circle_id, v_invite.invited_by, 'primary_caretaker',
        true, true, true, true, true,
        'active', v_invite.invited_by
      )
      on conflict (circle_id, user_id)
      do update set status = 'active';   -- never re-grant perms
    end if;

    select display_name into v_elder_name from public.profiles where id = v_elder_id;
  else
    insert into public.care_circle_members (
      circle_id, user_id, member_role,
      can_read_health, can_read_location, can_chat, can_call, can_manage_circle,
      status, invited_by
    ) values (
      v_invite.circle_id, v_user, v_invite.member_role,
      true,
      case when v_invite.member_role in ('primary_caretaker','family') then true else false end,
      true,
      true,
      v_invite.member_role = 'primary_caretaker',   -- step32d: family members never manage the circle
      'active', v_invite.invited_by
    )
    on conflict (circle_id, user_id)
    do update set status = 'active';   -- existing member: no role/perm change

    v_circle_id := v_invite.circle_id;

    -- Report the role actually held, which for an existing member is their
    -- own, not the invite's.
    select m.member_role into v_role
    from public.care_circle_members m
    where m.circle_id = v_circle_id and m.user_id = v_user;

    select c.elder_id into v_elder_id from public.care_circles c where c.id = v_circle_id;
    select p.display_name into v_elder_name
      from public.care_circles c
      join public.profiles p on p.id = c.elder_id
      where c.id = v_circle_id;
  end if;

  update public.care_circle_invites
    set accepted_at = now()
    where id = v_invite.id;

  return query select v_circle_id, v_elder_id, v_elder_name, v_role;
end;
$$;

-- ── 1. Existing rows: only primary caretakers manage ─────────────────────────
update public.care_circle_members
   set can_manage_circle = false
 where can_manage_circle
   and member_role in ('family', 'doctor');

-- ── 2. Role changes must fit the account ────────────────────────────────────
create or replace function public.set_circle_member_role(p_circle_id uuid, p_user_id uuid, p_role public.circle_member_role)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid();
  v_elder uuid;
  v_account public.app_role;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  select elder_id into v_elder from public.care_circles where id = p_circle_id;
  if v_elder is null then raise exception 'circle_not_found'; end if;

  if not (v_me = v_elder or public.has_perm(v_elder, 'manage')) then
    raise exception 'forbidden';
  end if;
  if p_user_id = v_elder then raise exception 'cannot_change_elder'; end if;

  -- step32d: the new circle role must fit the person's permanent account role.
  select p.role into v_account from public.profiles p where p.id = p_user_id;
  if v_account is null or not public._link_role_ok(v_account, p_role) then
    raise exception 'wrong_role';
  end if;

  -- Re-derive permission flags from the target role so a role change keeps
  -- the permission set coherent (doctor loses location + manage, etc.).
  update public.care_circle_members
    set member_role = p_role,
        can_read_health   = true,
        can_read_location = (p_role in ('primary_caretaker','family')),
        can_chat          = true,
        can_call          = true,
        can_manage_circle = (p_role = 'primary_caretaker')   -- step32d
    where circle_id = p_circle_id and user_id = p_user_id;

  insert into public.audit_log (actor_id, action, resource_type, resource_id, elder_id, payload)
  values (v_me, 'circle_member_role_changed', 'care_circle_member', p_user_id::text, v_elder,
          jsonb_build_object('circle_id', p_circle_id, 'new_role', p_role));

  return true;
end
$$;

-- ── 3. The elder's own phone sets the elder's time zone ──────────────────────
create or replace function public.set_my_timezone(p_tz text)
returns boolean                -- true when it changed
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
  r record;
  v_next timestamptz;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  -- Elders only; anyone else's call changes nothing.
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'elder') then
    return false;
  end if;
  if p_tz is null or not exists (select 1 from pg_timezone_names z where z.name = p_tz) then
    return false;
  end if;
  select p.timezone into v_old from public.profiles p where p.id = v_uid;
  if v_old is not distinct from p_tz then
    return false;
  end if;

  update public.profiles set timezone = p_tz where id = v_uid;

  -- This elder's future unanswered events, made at the old local time → again at the new.
  delete from public.reminder_events e
   using public.reminders rm
   where rm.id = e.reminder_id
     and e.elder_id = v_uid
     and rm.local_time is not null
     and e.status = 'pending'
     and e.responded_at is null
     and e.scheduled_at > now();
  for r in select rm.id, rm.local_time from public.reminders rm
            where rm.elder_id = v_uid and rm.active and rm.local_time is not null
  loop
    v_next := public._reminder_next_local_time_run(v_uid, r.local_time, now());
    if not exists (select 1 from public.reminder_events e where e.reminder_id = r.id and e.scheduled_at = v_next) then
      insert into public.reminder_events (reminder_id, elder_id, scheduled_at, status) values (r.id, v_uid, v_next, 'pending');
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.set_my_timezone(text) from public, anon;
grant execute on function public.set_my_timezone(text) to authenticated;

-- Check (read-only): no one but primary caretakers may manage — expect 0.
-- select count(*) from public.care_circle_members where can_manage_circle and member_role <> 'primary_caretaker';
