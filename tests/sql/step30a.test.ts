// step30a — retiring the LLM Rafiq must not stop a single alert from reaching
// the family. Runs the real migration file on a throw-away Postgres (PGlite).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ALERT_KINDS, asUser, clearEdgeCalls, edgeCalls, migration, preStep30a } from './harness';

const STEP30A = '20261022090000_step30a_retire_llm_rafiq.sql';
const ELDER = '7e57e1de-0000-4000-c000-000000000001';
const OTHER = '7e57e1de-0000-4000-c000-000000000002';

let db: PGlite;

async function raise(kind: string, severity: string, payload: Record<string, unknown> = {}) {
  await clearEdgeCalls(db);
  const r = await db.query<{ id: string }>(
    `insert into public.health_alerts (elder_id, kind, severity, payload)
     values ($1, $2::public.alert_kind, $3::public.alert_severity, $4::jsonb) returning id`,
    [ELDER, kind, severity, JSON.stringify(payload)],
  );
  return { id: r.rows[0].id, calls: await edgeCalls(db) };
}

beforeAll(async () => {
  db = await preStep30a();
  await db.exec(`
    insert into public.profiles (id, display_name) values ('${ELDER}', 'Mona Hassan'), ('${OTHER}', 'Omar');
    insert into public.ai_conversations (id, user_id, elder_id, title)
      values ('11111111-0000-4000-8000-000000000001', '${ELDER}', '${ELDER}', 'old chat'),
             ('11111111-0000-4000-8000-000000000002', '${OTHER}', '${OTHER}', 'someone else');
    insert into public.ai_messages (conversation_id, role, content) values
      ('11111111-0000-4000-8000-000000000001', 'user', 'hello Rafiq'),
      ('11111111-0000-4000-8000-000000000001', 'assistant', 'hello Mona'),
      ('11111111-0000-4000-8000-000000000002', 'user', 'not Mona''s');
    insert into public.ai_health_assessments (elder_id, severity, explanation_ar) values ('${ELDER}', 'info', 'old assessment');
  `);
}, 60_000);

describe('before step30a (the live state)', () => {
  it('a manual high heart rate is only pushed through analyze-vitals', async () => {
    const { calls } = await raise('hr_high', 'warning', { value: 118 });
    expect(calls.map((c) => c.fn)).toEqual(['analyze-vitals']);
  });
});

describe('applying step30a', () => {
  it('applies cleanly', async () => {
    await db.exec(migration(STEP30A));
  });
  it('can be applied twice (safe to re-run)', async () => {
    await db.exec(migration(STEP30A));
  });
});

describe('alerts still reach the family, without any AI', () => {
  it('manual high heart rate: one push straight to notify-fanout, with the number', async () => {
    const { id, calls } = await raise('hr_high', 'warning', { value: 118, vital_id: 7, kind: 'heart_rate' });
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.fn).toBe('notify-fanout');
    expect(c.body).toMatchObject({ elder_id: ELDER, severity: 'warning', source_kind: 'health_alert', source_id: id });
    expect(c.body.texts.en.title).toBe('High heart rate: Mona');
    expect(c.body.texts.en.body).toBe(
      "Mona's heart rate was 118 bpm. Check on them, and contact the doctor if you are worried.");
    expect(c.body.texts.ar.body).toContain('118');
    expect(c.body.title_ar).toBe(c.body.texts.en.title); // notify-fanout's required fields
    expect(c.body.body_ar).toBe(c.body.texts.en.body);
  });

  it('band critical confirmed by a second reading: pushed as critical', async () => {
    const { calls } = await raise('spo2_low', 'critical', {
      source: 'band', kind: 'spo2', value: 86, confirmed: true, band_serial: 'SB1-0001' });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.severity).toBe('critical');
    expect(calls[0].body.texts.en.body).toBe(
      "Mona's oxygen level was 86% (Salem Band, confirmed by a second reading). Call them now.");
    expect(calls[0].body.texts.ar.body).toContain('سوار سليم');
  });

  it('band warning (no no_fanout): pushed', async () => {
    const { calls } = await raise('hr_low', 'warning', { source: 'band', kind: 'heart_rate', value: 48 });
    expect(calls.map((c) => c.fn)).toEqual(['notify-fanout']);
    expect(calls[0].body.texts.en.body).toContain('48 bpm (Salem Band)');
  });

  it('decimal values keep one decimal, whole numbers none', async () => {
    const a = await raise('spo2_low', 'warning', { value: 91.5 });
    expect(a.calls[0].body.texts.en.body).toContain('91.5%');
    const b = await raise('spo2_low', 'warning', { value: '90' });
    expect(b.calls[0].body.texts.en.body).toContain('90%');
  });

  it('SOS: the step28a emergency push, once, and no AI follow-up', async () => {
    const { calls } = await raise('sos', 'critical', { source: 'manual_button', raised_by: ELDER });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('notify-fanout');
    expect(calls[0].body.severity).toBe('critical');
    expect(calls[0].body.source_kind).toBe('sos');
    expect(calls[0].body.texts.en.title).toBe('SOS from Mona');
  });

  it('fall: the emergency push, once', async () => {
    const { calls } = await raise('fall_detected', 'critical');
    expect(calls).toHaveLength(1);
    expect(calls[0].body.texts.en.title).toBe('Possible fall: Mona');
  });

  it('alerts that push themselves (no_fanout) are left alone', async () => {
    const { calls } = await raise('trend', 'warning', { no_fanout: true });
    expect(calls).toEqual([]);
  });

  it('every alert kind gets a title and body in both languages, never "null"', async () => {
    for (const kind of ALERT_KINDS) {
      for (const severity of ['info', 'warning'] as const) {
        const { calls } = await raise(kind, severity);
        expect(calls, `${kind}/${severity}`).toHaveLength(1);
        const t = calls[0].body.texts;
        for (const lang of ['en', 'ar'] as const) {
          expect(t[lang].title, `${kind} ${lang} title`).toMatch(/\S/);
          expect(t[lang].body, `${kind} ${lang} body`).toMatch(/\S/);
          expect(`${t[lang].title} ${t[lang].body}`).not.toMatch(/null|undefined/i);
        }
      }
    }
  });

  it('a missing name falls back to "Your family member"', async () => {
    await db.exec(`update public.profiles set display_name = null where id = '${ELDER}'`);
    const { calls } = await raise('hr_high', 'warning', { value: 120 });
    expect(calls[0].body.texts.en.title).toBe('High heart rate: Your family member');
    await db.exec(`update public.profiles set display_name = 'Mona Hassan' where id = '${ELDER}'`);
  });

  it('if the push request itself fails, the alert row is still saved', async () => {
    await db.exec(`insert into public.test_flags values ('post_edge_fails', true)`);
    try {
      const { id, calls } = await raise('hr_high', 'warning', { value: 125 });
      expect(calls).toEqual([]);
      const r = await db.query('select 1 from public.health_alerts where id = $1', [id]);
      expect(r.rows).toHaveLength(1);
    } finally {
      await db.exec(`delete from public.test_flags where key = 'post_edge_fails'`);
    }
  });

  it('nothing in the database calls analyze-vitals any more', async () => {
    const r = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosrc ilike '%analyze-vitals%'`);
    expect(r.rows).toEqual([]);
  });
});

describe('the LLM-only functions are gone', () => {
  it.each(['record_ai_assessment', 'recent_ai_assessments', 'resolve_contacts', 'recent_health_context'])(
    '%s', async (name) => {
      const r = await db.query(`select 1 from pg_proc where proname = $1`, [name]);
      expect(r.rows).toEqual([]);
    });
});

describe('the old tables are renamed and locked, with every row kept', () => {
  it('renamed, rows intact', async () => {
    const r = await db.query<{ old: string | null; c: number; m: number; a: number }>(`
      select to_regclass('public.ai_conversations')::text as old,
             (select count(*)::int from public.retired_ai_conversations) as c,
             (select count(*)::int from public.retired_ai_messages) as m,
             (select count(*)::int from public.retired_ai_health_assessments) as a`);
    expect(r.rows[0]).toEqual({ old: null, c: 2, m: 3, a: 1 });
  });

  it('no policies left, RLS still on', async () => {
    const r = await db.query<{ relname: string; rls: boolean; policies: number }>(`
      select c.relname, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
        from pg_class c where c.relname like 'retired_ai_%' order by 1`);
    expect(r.rows).toEqual([
      { relname: 'retired_ai_conversations', rls: true, policies: 0 },
      { relname: 'retired_ai_health_assessments', rls: true, policies: 0 },
      { relname: 'retired_ai_messages', rls: true, policies: 0 },
    ]);
  });

  it.each(['retired_ai_conversations', 'retired_ai_messages', 'retired_ai_health_assessments'])(
    'an app user cannot read or write %s, not even their own rows', async (table) => {
      await asUser(db, ELDER, async () => {
        await expect(db.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
        await expect(db.query(`delete from public.${table}`)).rejects.toThrow(/permission denied/);
      });
    });

  it('account deletion still removes a person\'s retired rows (foreign keys survive the rename)', async () => {
    const tmp = '7e57e1de-0000-4000-c000-000000000009';
    await db.exec(`
      insert into public.profiles (id, display_name) values ('${tmp}', 'Temp');
      insert into public.retired_ai_conversations (id, user_id) values ('22222222-0000-4000-8000-000000000001', '${tmp}');
      insert into public.retired_ai_messages (conversation_id, role, content) values ('22222222-0000-4000-8000-000000000001', 'user', 'x');
      delete from public.profiles where id = '${tmp}';`);
    const r = await db.query(`select 1 from public.retired_ai_messages where conversation_id = '22222222-0000-4000-8000-000000000001'`);
    expect(r.rows).toEqual([]);
  });
});

describe('what the app reads keeps working', () => {
  it('recent_health_alerts: same columns, the AI ones are always empty', async () => {
    await db.exec(`grant select on public.health_alerts, public.profiles to authenticated`);
    const rows = await asUser(db, ELDER, async () =>
      (await db.query<Record<string, unknown>>('select * from public.recent_health_alerts(5, false)')).rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0])).toEqual([
      'id', 'elder_id', 'elder_name', 'kind', 'severity', 'payload', 'acknowledged_by',
      'acknowledged_at', 'resolved_at', 'created_at', 'ai_explanation_ar', 'ai_recommended_action']);
    expect(rows.every((r) => r.ai_explanation_ar === null && r.ai_recommended_action === null)).toBe(true);
  });

  it('export_account_data still exports the person\'s own old chats and assessments, nobody else\'s', async () => {
    const out = await asUser(db, ELDER, async () =>
      (await db.query<{ d: any }>('select public.export_account_data() as d')).rows[0].d);
    expect(out.ai_assessments).toHaveLength(1);
    expect(out.ai_assessments[0].explanation_ar).toBe('old assessment');
    expect(out.ai_conversations).toHaveLength(1);
    expect(out.ai_conversations[0].conversation.title).toBe('old chat');
    expect(out.ai_conversations[0].messages.map((m: any) => m.content)).toEqual(['hello Rafiq', 'hello Mona']);
  });
});

describe('scripts/rafiq/check-step30a.sql (the live check for the founder)', () => {
  it('every line is ok on the migrated database', async () => {
    const sql = readFileSync(join(__dirname, '..', '..', 'scripts', 'rafiq', 'check-step30a.sql'), 'utf8');
    const r = await db.query<{ n: number; check_name: string; ok: boolean }>(sql);
    expect(r.rows).toHaveLength(11);
    expect(r.rows.filter((x) => !x.ok).map((x) => x.check_name)).toEqual([]);
  });
});
