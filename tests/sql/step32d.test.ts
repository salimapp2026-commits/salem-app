// step32d: family members join with health and location but never "manage the circle";
// only the elder and the primary caretaker make codes; a role change must fit the
// account (a doctor never becomes "family" and never gets location); the elder's own
// phone sets the elder's time zone and their future doses move with it.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { asUser, extractFunction, migration } from './harness';
import { LINKING_LIVE } from './linkingSchema';

const STEP32B = '20261101090100_step32b_family_linking.sql';
const STEP32C = '20261101090200_step32c_help_numbers_crisis_privacy_reminder_tz.sql';
const STEP32D = '20261101090300_step32d_manage_roles_timezone.sql';
const ELDER = '00000000-0000-0000-0000-0000000000e1';
const PRIMARY = '00000000-0000-0000-0000-0000000000c1';
const FAMILY = '00000000-0000-0000-0000-0000000000c2';
const NEWCARER = '00000000-0000-0000-0000-0000000000c3';
const DOCTOR = '00000000-0000-0000-0000-0000000000d1';
const CIRCLE = '00000000-0000-0000-0000-00000000c1c1';

// What else step32d touches, as live (2026-11-01): profiles.timezone, audit_log, the
// reminders, and set_circle_member_role verbatim.
const MORE = `
alter table public.profiles add column timezone text default 'UTC';
create table public.audit_log (actor_id uuid, action text, resource_type text, resource_id text, elder_id uuid, payload jsonb);
create table public.reminders (id bigserial primary key, elder_id uuid, title text, local_time time, next_run_at timestamptz, active boolean default true);
create table public.reminder_events (id bigserial primary key, reminder_id bigint, elder_id uuid, scheduled_at timestamptz,
  status text default 'pending', responded_at timestamptz, notes text);
create function public.has_perm(p_elder_id uuid, p_perm text) returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v_allowed boolean := false;
begin
  if p_elder_id = auth.uid() then return true; end if;
  select case p_perm when 'health' then m.can_read_health when 'location' then m.can_read_location
    when 'chat' then m.can_chat when 'call' then m.can_call when 'manage' then m.can_manage_circle else false end
  into v_allowed from public.care_circle_members m join public.care_circles c on c.id = m.circle_id
  where c.elder_id = p_elder_id and m.user_id = auth.uid() and m.status = 'active';
  return coalesce(v_allowed, false);
end; $$;
-- care_circle_members' live policies.
create function public.is_in_circle(p_elder uuid) returns boolean language sql stable security definer as
  $$ select exists (select 1 from public.care_circle_members m join public.care_circles c on c.id = m.circle_id
                    where c.elder_id = p_elder and m.user_id = auth.uid() and m.status = 'active') $$;
alter table public.care_circle_members enable row level security;
create policy ccm_select on public.care_circle_members for select using ((user_id = auth.uid())
  or (exists (select 1 from public.care_circles c where c.id = care_circle_members.circle_id and c.elder_id = auth.uid()))
  or public.is_in_circle((select care_circles.elder_id from public.care_circles where care_circles.id = care_circle_members.circle_id)));
create policy ccm_write on public.care_circle_members for all
  using ((exists (select 1 from public.care_circles c where c.id = care_circle_members.circle_id and c.elder_id = auth.uid()))
    or public.has_perm((select care_circles.elder_id from public.care_circles where care_circles.id = care_circle_members.circle_id), 'manage'))
  with check ((exists (select 1 from public.care_circles c where c.id = care_circle_members.circle_id and c.elder_id = auth.uid()))
    or public.has_perm((select care_circles.elder_id from public.care_circles where care_circles.id = care_circle_members.circle_id), 'manage'));
create or replace function public.set_circle_member_role(p_circle_id uuid, p_user_id uuid, p_role public.circle_member_role)
 returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare
  v_me uuid := auth.uid();
  v_elder uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  select elder_id into v_elder from public.care_circles where id = p_circle_id;
  if v_elder is null then raise exception 'circle_not_found'; end if;
  if not (v_me = v_elder or public.has_perm(v_elder, 'manage')) then
    raise exception 'forbidden';
  end if;
  if p_user_id = v_elder then raise exception 'cannot_change_elder'; end if;
  update public.care_circle_members
    set member_role = p_role, can_read_health = true,
        can_read_location = (p_role in ('primary_caretaker','family')), can_chat = true, can_call = true,
        can_manage_circle = (p_role in ('primary_caretaker','family'))
    where circle_id = p_circle_id and user_id = p_user_id;
  insert into public.audit_log (actor_id, action, resource_type, resource_id, elder_id, payload)
  values (v_me, 'circle_member_role_changed', 'care_circle_member', p_user_id::text, v_elder,
          jsonb_build_object('circle_id', p_circle_id, 'new_role', p_role));
  return true;
end
$function$;
`;

let db: PGlite;
const q = async <T = Record<string, unknown>>(user: string, sql: string) =>
  (await asUser(db, user, () => db.query<T>(sql))).rows;
const member = async (user: string) => (await db.query<{ member_role: string; can_read_location: boolean; can_manage_circle: boolean }>(
  `select member_role, can_read_location, can_manage_circle from public.care_circle_members where circle_id = '${CIRCLE}' and user_id = '${user}'`)).rows[0];
const make = async (user: string, role: string) =>
  (await q<{ code: string }>(user, `select * from public.create_link_code('${role}', null)`))[0].code;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(LINKING_LIVE);
  await db.exec(MORE);
  await db.exec(extractFunction(STEP32C, '_reminder_next_local_time_run'));
  await db.exec(migration(STEP32B));
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    truncate public.profiles, public.care_circles, public.care_circle_members, public.care_circle_invites,
             public.pairing_attempts, public.reminders, public.reminder_events, public.audit_log;
    insert into public.profiles (id, role, display_name, timezone) values
      ('${ELDER}', 'elder', 'Mona', 'UTC'), ('${PRIMARY}', 'family', 'Omar', 'Africa/Cairo'),
      ('${FAMILY}', 'family', 'Sara', 'Africa/Cairo'), ('${NEWCARER}', 'caretaker', 'Karim', 'Africa/Cairo'),
      ('${DOCTOR}', 'doctor', 'Dr Hany', 'Africa/Cairo');
    insert into public.care_circles (id, elder_id) values ('${CIRCLE}', '${ELDER}');
    insert into public.care_circle_members (circle_id, user_id, member_role, can_read_location, can_manage_circle, status) values
      ('${CIRCLE}', '${PRIMARY}', 'primary_caretaker', true, true, 'active'),
      ('${CIRCLE}', '${FAMILY}', 'family', true, true, 'active'),          -- joined under the old default
      ('${CIRCLE}', '${DOCTOR}', 'doctor', false, false, 'active');
  `);
  await db.exec(migration(STEP32D));
}, 30_000);

describe('step32d: who manages the circle', () => {
  it('applying it corrects a family member who had "manage"; primary caretakers keep it', async () => {
    expect(await member(FAMILY)).toEqual({ member_role: 'family', can_read_location: true, can_manage_circle: false });
    expect(await member(PRIMARY)).toEqual({ member_role: 'primary_caretaker', can_read_location: true, can_manage_circle: true });
    await db.exec(migration(STEP32D));   // safe to apply twice
    expect((await member(FAMILY)).can_manage_circle).toBe(false);
  });
  it('a family member who joins by code gets health and location, not manage', async () => {
    const code = await make(ELDER, 'caregiver');
    expect((await q<{ status: string }>(NEWCARER, `select * from public.redeem_link_code('${code}')`))[0].status).toBe('ok');
    expect(await member(NEWCARER)).toEqual({ member_role: 'family', can_read_location: true, can_manage_circle: false });
  });
  it('the same through an email invite', async () => {
    await db.exec(`insert into public.care_circle_invites (circle_id, invited_by, member_role, token) values ('${CIRCLE}', '${ELDER}', 'family', 'tok-1')`);
    await q(NEWCARER, `select * from public.redeem_circle_invite('tok-1')`);
    expect(await member(NEWCARER)).toEqual({ member_role: 'family', can_read_location: true, can_manage_circle: false });
  });
  it('only the elder and the primary caretaker make codes; a family member cannot', async () => {
    expect(await make(ELDER, 'caregiver')).toMatch(/^\d{4}$/);
    expect(await make(PRIMARY, 'doctor')).toMatch(/^\d{4}$/);
    await expect(make(FAMILY, 'caregiver')).rejects.toThrow(/no_circle/);
    // …but may still bring in their own parent (a different circle).
    expect(await make(FAMILY, 'parent')).toMatch(/^\d{4}$/);
  });
  it('a family member cannot add or remove members directly either', async () => {
    const del = await q(FAMILY, `delete from public.care_circle_members where user_id = '${DOCTOR}' returning user_id`);
    expect(del).toEqual([]);
    // The primary caretaker still can.
    expect(await q(PRIMARY, `delete from public.care_circle_members where user_id = '${DOCTOR}' returning user_id`)).toHaveLength(1);
  });
});

describe('step32d: role changes fit the account', () => {
  it('a doctor account cannot be made "family" (no location for doctors)', async () => {
    await expect(q(PRIMARY, `select public.set_circle_member_role('${CIRCLE}', '${DOCTOR}', 'family')`)).rejects.toThrow(/wrong_role/);
    expect(await member(DOCTOR)).toEqual({ member_role: 'doctor', can_read_location: false, can_manage_circle: false });
  });
  it('a caregiver account cannot be made "doctor"', async () => {
    await expect(q(PRIMARY, `select public.set_circle_member_role('${CIRCLE}', '${FAMILY}', 'doctor')`)).rejects.toThrow(/wrong_role/);
  });
  it('promoting to primary caretaker gives manage; back to family takes it away', async () => {
    await q(ELDER, `select public.set_circle_member_role('${CIRCLE}', '${FAMILY}', 'primary_caretaker')`);
    expect((await member(FAMILY)).can_manage_circle).toBe(true);
    await q(ELDER, `select public.set_circle_member_role('${CIRCLE}', '${FAMILY}', 'family')`);
    expect(await member(FAMILY)).toEqual({ member_role: 'family', can_read_location: true, can_manage_circle: false });
  });
  it('a family member can no longer change roles', async () => {
    await expect(q(FAMILY, `select public.set_circle_member_role('${CIRCLE}', '${PRIMARY}', 'family')`)).rejects.toThrow(/forbidden/);
  });
});

describe('step32d: the elder\'s own phone sets the time zone', () => {
  const next = async () => (await db.query<{ t: string }>(`
    select to_char(e.scheduled_at at time zone 'Africa/Cairo', 'HH24:MI') t from public.reminder_events e
     where e.elder_id = '${ELDER}' and e.status = 'pending' and e.scheduled_at > now()`)).rows.map((r) => r.t);

  it('changes only when different, and moves future unanswered doses to the new local time', async () => {
    await db.exec(`insert into public.reminders (elder_id, title, local_time) values ('${ELDER}', 'Concor', '08:00')`);
    // A dose made while the profile said UTC: 08:00 UTC = 10:00 Cairo (winter).
    await db.exec(`insert into public.reminder_events (reminder_id, elder_id, scheduled_at)
      select 1, '${ELDER}', public._reminder_next_local_time_run('${ELDER}', '08:00', now())`);
    await db.exec(`insert into public.reminder_events (reminder_id, elder_id, scheduled_at, status, responded_at)
      values (1, '${ELDER}', now() + interval '3 days', 'snoozed', now())`);   // answered: never touched
    expect(await next()).toEqual(['10:00']);
    expect((await q<{ c: boolean }>(ELDER, `select public.set_my_timezone('Africa/Cairo') c`))[0].c).toBe(true);
    expect(await next()).toEqual(['08:00']);
    expect((await db.query(`select 1 from public.reminder_events where status = 'snoozed'`)).rows).toHaveLength(1);
    expect((await q<{ c: boolean }>(ELDER, `select public.set_my_timezone('Africa/Cairo') c`))[0].c).toBe(false);   // unchanged
  });
  it('only an elder, only their own profile, only a real zone', async () => {
    expect((await q<{ c: boolean }>(PRIMARY, `select public.set_my_timezone('Europe/London') c`))[0].c).toBe(false);
    expect((await db.query<{ timezone: string }>(`select timezone from public.profiles where id = '${PRIMARY}'`)).rows[0].timezone).toBe('Africa/Cairo');
    expect((await q<{ c: boolean }>(ELDER, `select public.set_my_timezone('Mars/Olympus') c`))[0].c).toBe(false);
    expect((await db.query<{ timezone: string }>(`select timezone from public.profiles where id = '${ELDER}'`)).rows[0].timezone).toBe('UTC');
  });
});
