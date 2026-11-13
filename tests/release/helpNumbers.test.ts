// Release gate, not part of `npm test`: run with `npm run test:release` before the
// release build. Fails until the founder has confirmed the crisis help numbers in
// native/src/lib/rafiqChat/lines.ts (and in app_config 'rafiq_chat' on the server).
import { describe, expect, it } from 'vitest';
import { HELP_NUMBERS, HELP_NUMBERS_ARE_PLACEHOLDERS } from '../../native/src/lib/rafiqChat/lines';

describe('release: crisis help numbers', () => {
  it('are confirmed by the founder, not placeholders', () => {
    expect(HELP_NUMBERS_ARE_PLACEHOLDERS).toBe(false);
    for (const h of HELP_NUMBERS) {
      expect(h.phone).toMatch(/^\+?\d{3,15}$/);
      expect(h.phone).not.toMatch(/^0+$/);
      expect(`${h.label.en} ${h.label.ar}`).not.toMatch(/CONFIRM|للتأكيد/);
    }
  });
});
