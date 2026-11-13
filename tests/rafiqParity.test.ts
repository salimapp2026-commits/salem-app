// Python ⇄ TypeScript parity for Rafiq. The fixtures were written by
// ml/rafiq/train.py: raw band rows + events for synthetic elders (one spanning
// Egypt's switch to summer time on 2027-04-30), and every value Python computed.
// The TypeScript scorer must reproduce all of it EXACTLY — not "close": the
// same aggregates, baselines, z-scores, features, forest path, level and reasons.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  type Agg, dayAggregates, decideElder, elderFeatures, type Rows,
} from '../supabase/functions/_shared/rafiq/core.ts';
import { meanPath } from '../supabase/functions/_shared/rafiq/forest.ts';
import type { RafiqModel } from '../supabase/functions/_shared/rafiq/model.ts';

const ROOT = join(__dirname, '..');
const model = JSON.parse(readFileSync(join(ROOT, 'supabase/functions/_shared/rafiq/model.json'), 'utf8')) as RafiqModel;

/** JSON has no NaN: Python wrote null. Map TypeScript's NaN the same way before comparing. */
function nn(x: unknown): unknown {
  if (typeof x === 'number' && x !== x) return null;
  if (Array.isArray(x)) return x.map(nn);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, nn(v)]));
  return x;
}

type Expected = {
  day: number; agg: Record<string, number | null>; z: Record<string, number | null>;
  base: Record<string, [number, number] | null>; features: Record<string, number | null>;
  vector: number[]; learning: boolean; path: number; level: string;
  reasons: { code: string; level: string; days: number; params: Record<string, unknown> }[];
};

function load(name: string) {
  const f = JSON.parse(gunzipSync(readFileSync(join(ROOT, `tests/fixtures/rafiq/parity-${name}.json.gz`))).toString('utf8'));
  const rows: Rows = { ...f.rows, resting: (f.rows.resting as number[]).map((x) => x === 1) };
  return { tz: f.tz as string, rows, events: f.events, expected: f.expected as Expected[], version: f.model_version as string };
}

for (const name of ['nov-2026', 'dst-apr-2027', 'fall-inactivity']) {
  describe(`parity: ${name}`, () => {
    const fx = load(name);
    const agg: Map<number, Agg> = dayAggregates(fx.rows, fx.events, fx.tz, model.params);
    const feats = elderFeatures(agg, model.features, model.params, model.ewma_alpha);
    const paths = new Map([...feats].map(([d, f]) => [d, meanPath(model.forest, f.vector)]));
    const dec = decideElder(feats, paths, model.thresholds, model.decide, model.features);

    it('was written by this model version', () => {
      expect(fx.version).toBe(model.version);
    });

    it('the same days', () => {
      expect([...feats.keys()]).toEqual(fx.expected.map((e) => e.day));
    });

    it('daily aggregates, baselines and z-scores: identical', () => {
      for (const e of fx.expected) {
        const f = feats.get(e.day)!;
        expect(nn(f.agg), `agg day ${e.day}`).toEqual(e.agg);
        expect(nn(f.base), `base day ${e.day}`).toEqual(e.base);
        expect(nn(f.z), `z day ${e.day}`).toEqual(e.z);
        expect(f.learning, `learning day ${e.day}`).toBe(e.learning);
      }
    });

    it('all 20 features and the model input vector: identical', () => {
      for (const e of fx.expected) {
        const f = feats.get(e.day)!;
        expect(nn(f.features), `features day ${e.day}`).toEqual(e.features);
        expect(f.vector, `vector day ${e.day}`).toEqual(e.vector);
      }
    });

    it('Isolation Forest path length: identical to the last bit', () => {
      for (const e of fx.expected) {
        expect(Object.is(paths.get(e.day), e.path), `path day ${e.day}: ${paths.get(e.day)} vs ${e.path}`).toBe(true);
      }
    });

    it('levels and reasons: identical', () => {
      for (const e of fx.expected) {
        const d = dec.get(e.day)!;
        expect(d.level, `level day ${e.day}`).toBe(e.level);
        expect(nn(d.reasons), `reasons day ${e.day}`).toEqual(e.reasons);
      }
    });
  });
}

describe('the fixtures exercise what matters', () => {
  it('learning days, every reason family, missing data, falls and a clock change', () => {
    const all = ['nov-2026', 'dst-apr-2027', 'fall-inactivity'].map(load);
    const codes = new Set(all.flatMap((f) => f.expected.flatMap((e) => e.reasons.map((r) => r.code))));
    expect([...codes].sort()).toEqual(
      ['activity_down', 'fall_then_still', 'resting_hr_up', 'spo2_night_down', 'temp_up'].sort());
    expect(all.some((f) => f.expected.some((e) => e.learning))).toBe(true);
    expect(all.some((f) => f.expected.some((e) => Object.values(e.agg).includes(null)))).toBe(true);
    expect(all.some((f) => f.events.t.length > 0)).toBe(true);
  });
});

describe('the deployed scorer checks its own model', () => {
  it('model.json passes: checksum and three known answers match Python exactly', async () => {
    const { modelSelfCheck } = await import('../supabase/functions/_shared/rafiq/forest.ts');
    expect(modelSelfCheck(model)).toEqual({ ok: true, fingerprint_ok: true, selftest_ok: true });
  });
  it('one changed digit anywhere in the forest is caught', async () => {
    const { modelSelfCheck } = await import('../supabase/functions/_shared/rafiq/forest.ts');
    const broken = JSON.parse(JSON.stringify(model)) as RafiqModel;
    const t = broken.forest.trees[57].t;
    const i = t.findIndex((x, k) => broken.forest.trees[57].f[k] >= 0);
    t[i] = Number(String(t[i]).replace(/\d(?=\d*$)/, (d) => String((Number(d) + 1) % 10)));
    expect(modelSelfCheck(broken).ok).toBe(false);
  });
});
