// step32b: family linking by typed code. Single use, 15 minutes, 5 wrong tries per 15
// minutes that really count (the old function's rolled back), the code's role must fit
// the joining account's permanent role (doctors never get location), joining only ever
// adds, and a caregiver without an elder links through the parent's own phone.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { asUser, migration } from './harness';
import { LINKING_LIVE as LIVE } from './linkingSchema';

const STEP32B = '20261101090100_step32b_family_linking.sql';
const ELDER = '00000000-0000-0000-0000-0000000000e1';
const ELDER2 = '00000000-0000-0000-0000-0000000000e2';
const CARER = '00000000-0000-0000-0000-0000000000c1';
const CARER2 = '00000000-0000-0000-0000-0000000000c2';
const NEWCARER = '00000000-0000-0000-0000-0000000000c3';
const DOCTOR = '00000000-0000-0000-0000-0000000000d1';
const CIRCLE = '00000000-0000-0000-0000-00000000c1c1';
const CIRCLE2 = '00000000-0000-0000-0000-00000000c2c2';


let db: PGlite;
const q = async <T = Record<string, unknown>>(user: string, sql: string) =>
  (await asUser(db, user, () => db.query<T>(sql))).rows;
const make = async (user: string, role: string, elder: string | null = null) =>
  (await q<{ code: string; expires_at: string; invite_id: string; joins_as: string }>(user,
    `select * from public.create_link_code('${role}', ${elder ? `'${elder}'` : 'null'})`))[0];
const peek = async (user: string, code: string) =>
  (await q<{ status: string; elder_name: string | null; inviter_name: string | null; joins_as: string | null }>(user, `select * from public.peek_link_code('${code}')`))[0];
const redeem = async (user: string, code: string) =>
  (await q<{ status: string; member_role: string | null; elder_id: string | null }>(user, `select * from public.redeem_link_code('${code}')`))[0];
const member = async (circle: string, user: string) =>
  (await db.query<{ member_role: string; can_read_location: boolean; can_manage_circle: boolean; status: string }>(
    `select member_role, can_read_location, can_manage_circle, status from public.care_circle_members where circle_id = '${circle}' and user_id = '${user}'`)).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(LIVE);
  await db.exec(migration(STEP32B));
  await db.exec(migration(STEP32B));   // safe to apply twice
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    truncate public.profiles, public.care_circles, public.care_circle_members, public.care_circle_invites, public.pairing_attempts;
    insert into public.profiles values
      ('${ELDER}', 'elder', 'Mona Adel'), ('${ELDER2}', 'elder', 'Hoda'),
      ('${CARER}', 'family', 'Omar'), ('${CARER2}', 'caretaker', 'Sara'), ('${NEWCARER}', 'family', 'Karim'),
      ('${DOCTOR}', 'doctor', 'Dr Hany');
    insert into public.care_circles (id, elder_id) values ('${CIRCLE}', '${ELDER}'), ('${CIRCLE2}', '${ELDER2}');
    insert into public.care_circle_members (circle_id, user_id, member_role, can_read_location, can_manage_circle, status)
      values ('${CIRCLE}', '${CARER}', 'primary_caretaker', true, true, 'active');
  `);
}, 30_000);

describe('step32b: making a code', () => {
  it('the elder and a managing caregiver can; a doctor cannot; 4 digits, 15 minutes', async () => {
    const a = await make(ELDER, 'caregiver');
    expect(a.code).toMatch(/^\d{4}$/);
    const mins = (Date.parse(a.expires_at) - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(14.5);
    expect(mins).toBeLessThanOrEqual(15);
    expect(a.joins_as).toBe('caregiver');
    expect((await make(CARER, 'doctor')).joins_as).toBe('doctor');
    await expect(make(DOCTOR, 'caregiver')).rejects.toThrow(/doctors_cannot_invite/);
    await expect(make(NEWCARER, 'caregiver')).rejects.toThrow(/no_circle/);   // not in any circle
    await expect(make(ELDER, 'admin')).rejects.toThrow(/bad_role/);
  });
  it('a new code replaces the maker\'s previous one', async () => {
    const a = await make(ELDER, 'caregiver');
    const b = await make(ELDER, 'caregiver');
    expect((await peek(NEWCARER, a.code)).status).toBe(a.code === b.code ? 'ok' : 'invalid_or_expired');
    expect((await peek(NEWCARER, b.code)).status).toBe('ok');
  });
});

describe('step32b: being invited', () => {
  it('peek shows who; redeem joins once; the code is then dead', async () => {
    const { code } = await make(ELDER, 'caregiver');
    expect(await peek(NEWCARER, code)).toEqual({ status: 'ok', elder_name: 'Mona Adel', inviter_name: 'Mona Adel', joins_as: 'caregiver' });
    expect(await member(CIRCLE, NEWCARER)).toBeUndefined();      // peeking joins nothing
    const r = await redeem(NEWCARER, code);
    expect(r).toMatchObject({ status: 'ok', member_role: 'family', elder_id: ELDER });   // a primary exists already
    expect(await member(CIRCLE, NEWCARER)).toEqual({ member_role: 'family', can_read_location: true, can_manage_circle: true, status: 'active' });
    expect((await redeem(CARER2, code)).status).toBe('invalid_or_expired');
  });
  it('expired codes do not work', async () => {
    const { code } = await make(ELDER, 'caregiver');
    await db.exec(`update public.care_circle_invites set pair_code_expires_at = now() - interval '1 second'`);
    expect((await redeem(NEWCARER, code)).status).toBe('invalid_or_expired');
  });
  it('a doctor joins only with a doctor code, and never gets location or management', async () => {
    const fam = await make(ELDER, 'caregiver');
    expect(await peek(DOCTOR, fam.code)).toEqual({ status: 'wrong_role', elder_name: null, inviter_name: null, joins_as: null });
    expect((await redeem(DOCTOR, fam.code)).status).toBe('wrong_role');
    expect(await member(CIRCLE, DOCTOR)).toBeUndefined();
    const doc = await make(ELDER, 'doctor');
    expect((await redeem(NEWCARER, doc.code)).status).toBe('wrong_role');       // a caregiver can't be a doctor
    expect((await redeem(DOCTOR, doc.code)).status).toBe('ok');
    expect(await member(CIRCLE, DOCTOR)).toEqual({ member_role: 'doctor', can_read_location: false, can_manage_circle: false, status: 'active' });
  });
  it('an elder never joins someone else\'s circle as a member', async () => {
    const { code } = await make(ELDER, 'caregiver');
    expect((await redeem(ELDER2, code)).status).toBe('wrong_role');
  });
  it('joining only adds: an existing member keeps their role and permissions', async () => {
    await db.exec(`insert into public.care_circle_members (circle_id, user_id, member_role, can_read_location, can_manage_circle, status)
      values ('${CIRCLE}', '${CARER2}', 'family', false, false, 'removed')`);
    const { code } = await make(ELDER, 'caregiver');
    expect((await redeem(CARER2, code)).status).toBe('ok');
    expect(await member(CIRCLE, CARER2)).toEqual({ member_role: 'family', can_read_location: false, can_manage_circle: false, status: 'active' });
    const again = await make(ELDER, 'caregiver');
    expect((await redeem(CARER, again.code)).status).toBe('already_member');
  });
  it('your own code is refused', async () => {
    const { code } = await make(CARER, 'caregiver');
    expect((await peek(CARER, code)).status).toBe('own_code');
  });
});

describe('step32b: wrong codes really count', () => {
  it('5 wrong tries in 15 minutes lock the user, even out of the right code', async () => {
    const { code } = await make(ELDER, 'caregiver');
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) expect((await peek(NEWCARER, wrong)).status).toBe('invalid_or_expired');
    expect((await db.query(`select count(*)::int n from public.pairing_attempts where user_id = '${NEWCARER}' and not succeeded`)).rows[0]).toEqual({ n: 5 });
    expect((await redeem(NEWCARER, code)).status).toBe('too_many_attempts');
    expect(await member(CIRCLE, NEWCARER)).toBeUndefined();
    // Someone else is not locked.
    expect((await peek(CARER2, code)).status).toBe('ok');
    // After 15 minutes the lock lifts.
    await db.exec(`update public.pairing_attempts set attempted_at = now() - interval '16 minutes'`);
    expect((await redeem(NEWCARER, code)).status).toBe('ok');
  });
  it('a right code with the wrong account counts as a wrong try', async () => {
    const { code } = await make(ELDER, 'caregiver');
    await peek(DOCTOR, code);
    expect((await db.query(`select count(*)::int n from public.pairing_attempts where user_id = '${DOCTOR}' and not succeeded`)).rows[0]).toEqual({ n: 1 });
  });
});

describe('step32b: a caregiver without an elder ("parent" code)', () => {
  it('the parent types it on their own phone; the caregiver joins the parent\'s circle', async () => {
    const p = await make(NEWCARER, 'parent');
    expect(p.joins_as).toBe('parent');
    expect((await redeem(CARER2, p.code)).status).toBe('wrong_role');           // only an elder account
    expect(await peek(ELDER2, p.code)).toEqual({ status: 'ok', elder_name: 'Hoda', inviter_name: 'Karim', joins_as: 'parent' });
    const r = await redeem(ELDER2, p.code);
    expect(r).toMatchObject({ status: 'ok', elder_id: ELDER2, member_role: 'primary_caretaker' });
    expect(await member(CIRCLE2, NEWCARER)).toEqual({ member_role: 'primary_caretaker', can_read_location: true, can_manage_circle: true, status: 'active' });
  });
  it('an elder cannot make a parent code; parent codes never work as email-invite tokens', async () => {
    await expect(make(ELDER, 'parent')).rejects.toThrow(/bad_role/);
    const p = await make(NEWCARER, 'parent');
    const token = (await db.query<{ token: string }>(`select token from public.care_circle_invites where id = '${p.invite_id}'`)).rows[0].token;
    await expect(q(ELDER2, `select * from public.redeem_circle_invite('${token}')`)).rejects.toThrow(/invite_not_found/);
  });
});

describe('step32b: the maker\'s screen and the old functions', () => {
  it('link_code_accepted turns true once used, and only for the maker', async () => {
    const { code, invite_id } = await make(ELDER, 'caregiver');
    const acc = async (u: string) => (await q<{ a: boolean }>(u, `select public.link_code_accepted('${invite_id}') a`))[0].a;
    expect(await acc(ELDER)).toBe(false);
    await redeem(NEWCARER, code);
    expect(await acc(ELDER)).toBe(true);
    expect(await acc(CARER2)).toBe(false);
  });
  it('the old pairing functions are closed to the app', async () => {
    await expect(q(ELDER, `select * from public.create_pairing_code()`)).rejects.toThrow(/permission denied/);
    await expect(q(NEWCARER, `select * from public.redeem_pairing_code('1234')`)).rejects.toThrow(/permission denied/);
  });
  it('email invites now check the role too: a doctor cannot redeem a family invite', async () => {
    await db.exec(`insert into public.care_circle_invites (circle_id, invited_by, member_role, token)
      values ('${CIRCLE}', '${ELDER}', 'family', 'tok-family')`);
    await expect(q(DOCTOR, `select * from public.redeem_circle_invite('tok-family')`)).rejects.toThrow(/wrong_role/);
    const ok = await q<{ r_member_role: string }>(NEWCARER, `select * from public.redeem_circle_invite('tok-family')`);
    expect(ok[0].r_member_role).toBe('family');
  });
});
