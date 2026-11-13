// The native app keeps copies of Rafiq's shared files (it can't import from
// supabase/functions). They must stay identical to the server's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
describe('native copies of shared Rafiq files', () => {
  for (const f of ['text.ts', 'core.ts']) {
    it(f, () => {
      expect(readFileSync(join(ROOT, 'native/src/supabase/functions/_shared/rafiq', f), 'utf8'))
        .toBe(readFileSync(join(ROOT, 'supabase/functions/_shared/rafiq', f), 'utf8'));
    });
  }
});
