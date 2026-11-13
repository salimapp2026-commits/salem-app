// The deploy carries the model as small parts (modelParts.ts). They must rebuild
// model.json exactly, and pass the same self-check the deployed scorer runs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modelSelfCheck } from '../supabase/functions/_shared/rafiq/forest.ts';
import { model as fromParts } from '../supabase/functions/_shared/rafiq/modelParts.ts';

const whole = JSON.parse(readFileSync(join(__dirname, '..', 'supabase/functions/_shared/rafiq/model.json'), 'utf8'));

describe('model parts for the deploy', () => {
  it('rebuild model.json exactly (every tree, every number)', () => {
    expect(fromParts).toEqual(whole);
    expect(fromParts.forest.trees).toHaveLength(whole.forest.n_trees);
  });
  it('pass the self-check the deployed scorer runs at start', () => {
    expect(modelSelfCheck(fromParts)).toEqual({ ok: true, fingerprint_ok: true, selftest_ok: true });
  });
});
