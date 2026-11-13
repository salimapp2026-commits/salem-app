-- step29a — in-app messaging is back (elder ↔ caregiver ↔ doctor).
--
-- The tables, RLS, realtime and RPCs were never dropped; only the app screens
-- were removed on 2026-09-25. This adds what the restored screens need and
-- closes one gap found while restoring:
--
-- 1. message_contacts(): the people the signed-in user may message — the same
--    "connected" rule get_or_create_direct_conversation already enforces (the
--    elder and the members of their circle, both ways, and members of the same
--    circle with each other).
-- 2. conversation_participants: the old "ALL using user_id = auth.uid()"
--    policy let any signed-in user INSERT themselves into any conversation
--    whose id they knew, and then read it. Joining now happens only through the
--    SECURITY DEFINER functions (get_or_create_direct_conversation,
--    create_family_conversation); a user may still remove (leave) their own row.
--    No app code ever inserted participant rows directly.

create or replace function public.message_contacts()
returns table (user_id uuid, display_name text, avatar_url text, relation text, elder_id uuid, elder_name text)
language sql stable security definer
set search_path = public
as $$
  with me as (select auth.uid() as id),
  links as (
    -- I am the elder: everyone active in my circle
    select m.user_id as other, m.member_role::text as relation, c.elder_id
      from public.care_circles c
      join public.care_circle_members m on m.circle_id = c.id
     where c.elder_id = (select id from me) and m.status = 'active'
    union
    -- I am a member: the elder of that circle
    select c.elder_id, 'elder', c.elder_id
      from public.care_circles c
      join public.care_circle_members m on m.circle_id = c.id
     where m.user_id = (select id from me) and m.status = 'active'
    union
    -- I am a member: the other active members of that circle
    select m2.user_id, m2.member_role::text, c.elder_id
      from public.care_circle_members m1
      join public.care_circles c on c.id = m1.circle_id
      join public.care_circle_members m2 on m2.circle_id = m1.circle_id
     where m1.user_id = (select id from me) and m1.status = 'active' and m2.status = 'active'
  )
  select distinct on (l.other) l.other, p.display_name, p.avatar_url, l.relation, l.elder_id, pe.display_name
    from links l
    join public.profiles p on p.id = l.other
    left join public.profiles pe on pe.id = l.elder_id
   where l.other <> (select id from me)
   order by l.other, case l.relation when 'elder' then 0 when 'primary_caretaker' then 1 when 'family' then 2 else 3 end;
$$;

revoke all on function public.message_contacts() from public, anon;
grant execute on function public.message_contacts() to authenticated;

drop policy if exists conv_participants_modify on public.conversation_participants;
drop policy if exists conv_participants_leave on public.conversation_participants;
create policy conv_participants_leave on public.conversation_participants
  for delete to authenticated using (user_id = auth.uid());
