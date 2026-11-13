-- step32b — Linking family members with a typed code (founder, 2026-11-01). No camera,
-- no scanning. Two flows, for every role:
--
--   "Add a family member"     create_link_code(p_role, p_elder_id) → a one-time 4-digit
--                             code for 15 minutes, shared by WhatsApp etc. The maker
--                             chooses what the new member is: 'caregiver' or 'doctor'.
--                             A caregiver who has no elder yet makes a 'parent' code:
--                             their parent types it on their own phone, and the
--                             caregiver joins the PARENT's circle (no circle without an
--                             elder).
--   "Be invited"              peek_link_code(code) → who you are joining, to confirm;
--                             redeem_link_code(code) → joins.
--
-- Safety:
--   • single use; 15 minutes; a new code replaces the maker's previous one
--   • 5 wrong codes per user per 15 minutes, then locked for the rest of the window.
--     FIXES A REAL HOLE: redeem_pairing_code recorded each failed attempt and then
--     raised an error, which rolled the record back — the limit never counted, so a
--     4-digit code could be guessed. These functions return a status instead of
--     raising, so the attempt row stays. redeem_pairing_code / create_pairing_code are
--     withdrawn from the app (execute revoked).
--   • the code's role must fit the joining account's permanent role: a doctor account
--     joins only as a doctor (never location, never managing the circle); a caregiver
--     account never joins as a doctor; an elder account never joins someone else's
--     circle as a member. FIXES A SECOND HOLE: redeem_circle_invite let a doctor
--     account redeem a family invite and get location. It now checks the same rule.
--   • joining only ever ADDS a member; an existing member's role and permissions never
--     change (see feedback: invites must not escalate).
--   • who may make a code: the elder, and caregivers who may manage the circle. Doctors
--     may not (they cannot manage a circle today) — founder to confirm (L1).
-- Safe to apply twice.

alter table public.care_circle_invites
  add column if not exists link_kind text not null default 'member';
do $$ begin
  alter table public.care_circle_invites
    add constraint care_circle_invites_link_kind check (link_kind in ('member', 'parent'));
exception when duplicate_object then null; end $$;

-- Which account roles may hold which circle role.
create or replace function public._link_role_ok(p_account public.app_role, p_member public.circle_member_role)
returns boolean
language sql
immutable
as $$
  select case
    when p_member = 'doctor' then p_account = 'doctor'
    else p_account in ('family', 'caretaker', 'admin')
  end;
$$;
revoke all on function public._link_role_ok(public.app_role, public.circle_member_role) from public, anon, authenticated;

-- ── Make a code ─────────────────────────────────────────────────────────────
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
revoke all on function public.create_link_code(text, uuid) from public, anon;
grant execute on function public.create_link_code(text, uuid) to authenticated;

-- Has my code been used? (the maker's screen waits for this)
create or replace function public.link_code_accepted(p_invite_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select i.accepted_at is not null from public.care_circle_invites i
                   where i.id = p_invite_id and i.invited_by = auth.uid()), false);
$$;
revoke all on function public.link_code_accepted(uuid) from public, anon;
grant execute on function public.link_code_accepted(uuid) to authenticated;

-- ── Check a typed code (shared by peek and redeem) ──────────────────────────
-- Never raises for a bad code, so the failed-attempt row is kept.
create or replace function public._check_link_code(p_code text, p_uid uuid, p_lock boolean,
  out status text, out invite public.care_circle_invites, out account public.app_role, out elder uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clean text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_fails int;
begin
  select count(*) into v_fails
  from public.pairing_attempts a
  where a.user_id = p_uid and a.succeeded = false and a.attempted_at > now() - interval '15 minutes';
  if v_fails >= 5 then
    status := 'too_many_attempts';
    return;
  end if;

  if length(v_clean) = 4 then
    if p_lock then
      select * into invite from public.care_circle_invites i
       where i.pair_code = v_clean and i.accepted_at is null and i.pair_code_expires_at > now()
       for update;
    else
      select * into invite from public.care_circle_invites i
       where i.pair_code = v_clean and i.accepted_at is null and i.pair_code_expires_at > now();
    end if;
  end if;
  if invite.id is null then
    insert into public.pairing_attempts (user_id, succeeded) values (p_uid, false);
    status := 'invalid_or_expired';
    return;
  end if;
  if invite.invited_by = p_uid then
    status := 'own_code';
    return;
  end if;

  select p.role into account from public.profiles p where p.id = p_uid;
  if invite.link_kind = 'parent' then
    select c.elder_id into elder from public.care_circles c where c.elder_id = p_uid;
    if account is distinct from 'elder' or elder is null then
      -- A valid code with the wrong account counts as a wrong try and reveals nothing.
      insert into public.pairing_attempts (user_id, succeeded) values (p_uid, false);
      status := 'wrong_role';
      return;
    end if;
    if exists (select 1 from public.care_circle_members m join public.care_circles c on c.id = m.circle_id
               where c.elder_id = p_uid and m.user_id = invite.invited_by and m.status = 'active') then
      status := 'already_member';
      return;
    end if;
  else
    select c.elder_id into elder from public.care_circles c where c.id = invite.circle_id;
    if elder is null or account is null or not public._link_role_ok(account, invite.member_role) then
      insert into public.pairing_attempts (user_id, succeeded) values (p_uid, false);
      status := 'wrong_role';
      return;
    end if;
    if exists (select 1 from public.care_circle_members m
               where m.circle_id = invite.circle_id and m.user_id = p_uid and m.status = 'active') then
      status := 'already_member';
      return;
    end if;
  end if;
  status := 'ok';
end;
$$;
revoke all on function public._check_link_code(text, uuid, boolean) from public, anon, authenticated;

-- ── "Be invited": see who, then join ────────────────────────────────────────
create or replace function public.peek_link_code(p_code text)
returns table (status text, elder_name text, inviter_name text, joins_as text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  r     record;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select * into r from public._check_link_code(p_code, v_uid, false);
  if r.status <> 'ok' then
    return query select r.status, null::text, null::text, null::text;
    return;
  end if;
  return query select 'ok'::text,
    (select p.display_name from public.profiles p where p.id = r.elder),
    (select p.display_name from public.profiles p where p.id = (r.invite).invited_by),
    case when (r.invite).link_kind = 'parent' then 'parent'
         when (r.invite).member_role = 'doctor' then 'doctor' else 'caregiver' end;
end;
$$;
revoke all on function public.peek_link_code(text) from public, anon;
grant execute on function public.peek_link_code(text) to authenticated;

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
    v_role in ('primary_caretaker', 'family'),
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
revoke all on function public.redeem_link_code(text) from public, anon;
grant execute on function public.redeem_link_code(text) to authenticated;

-- ── The old code path, closed ───────────────────────────────────────────────
revoke execute on function public.create_pairing_code(public.circle_member_role) from public, anon, authenticated;
revoke execute on function public.redeem_pairing_code(text) from public, anon, authenticated;

-- ── Email / link invites: the same role rule ────────────────────────────────
-- Unchanged from the live function except the two marked checks.
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
      case when v_invite.member_role in ('primary_caretaker','family') then true else false end,
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
revoke all on function public.redeem_circle_invite(text) from public, anon;
grant execute on function public.redeem_circle_invite(text) to authenticated;

-- Check (read-only):
-- select proname from pg_proc where proname in ('create_link_code','peek_link_code','redeem_link_code','link_code_accepted');
-- select has_function_privilege('authenticated', 'public.redeem_pairing_code(text)', 'execute');  -- false
