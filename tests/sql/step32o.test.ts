// step32o: four pushes' fallback fields (title_ar / body_ar) carry the Arabic text. Each
// function must be its previous version with only those two lines changed, and the new
// values must be exactly what the same push sends as texts.ar.
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { extractFunction, migration } from './harness';

const STEP32O = '20261108090500_step32o_arabic_fallback_four_pushes.sql';
const BEFORE: Record<string, string> = {
  dispatch_due_reminders: '20261101090400_step32e_reminders_to_elder.sql',
  expire_stale_reminder_events: '20261101090700_step32h_stopped_medicine_not_missed.sql',
  dispatch_rafiq_checkins: '20261108090000_step32j_checkin_push_low_mood.sql',
  add_sos_location: '20261014090100_step29b_location_retention.sql',
};

const lines = (s: string) => s.split('\n');
const changed = (a: string, b: string) => {
  const x = lines(a);
  const y = lines(b);
  expect(y).toHaveLength(x.length);
  return x.map((l, i) => [l, y[i]]).filter(([l, m]) => l !== m);
};
// The value after a key in jsonb_build_object(…), up to the end of its line.
const field = (body: string, key: string) => body.match(new RegExp(`'${key}', (.+?),?\\n`))![1];

describe('step32o', () => {
  for (const [fn, file] of Object.entries(BEFORE)) {
    it(`${fn}: only the title_ar / body_ar lines change, to the texts.ar values`, () => {
      const before = extractFunction(file, fn);
      const after = extractFunction(STEP32O, fn);
      const diff = changed(before, after);
      expect(diff.map(([l]) => l.trim().split(',')[0])).toEqual(["'title_ar'", "'body_ar'"]);

      const ar = after.match(/'ar', jsonb_build_object\('title', (.+?), 'body', (.+?)\)\)/)!;
      expect(field(after, 'title_ar')).toBe(ar[1]);
      expect(field(after, 'body_ar')).toBe(ar[2]);
      // The quoted text in the new fields is Arabic (variable names aside).
      for (const k of ['title_ar', 'body_ar']) {
        for (const lit of field(after, k).match(/'[^']*'/g) ?? []) expect(lit, `${fn} ${k}`).not.toMatch(/[A-Za-z]{3}/);
      }
    });
  }

  it('applies (twice) and keeps the grants: the app may call add_sos_location, nothing else', async () => {
    const db = new PGlite();
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create table public.health_alerts (id uuid primary key, elder_id uuid, kind text, created_at timestamptz);`);
    await db.exec(migration(STEP32O));
    await db.exec(migration(STEP32O));
    const can = async (sig: string) => (await db.query<{ ok: boolean }>(
      `select has_function_privilege('authenticated', '${sig}', 'execute') ok`)).rows[0].ok;
    expect(await can('public.add_sos_location(uuid, double precision, double precision, real)')).toBe(true);
    expect(await can('public.dispatch_due_reminders(integer)')).toBe(false);
    expect(await can('public.expire_stale_reminder_events()')).toBe(false);
    expect(await can('public.dispatch_rafiq_checkins(timestamptz)')).toBe(false);
    const anon = await db.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'public.add_sos_location(uuid, double precision, double precision, real)', 'execute') ok`);
    expect(anon.rows[0].ok).toBe(false);
  }, 60_000);
});
