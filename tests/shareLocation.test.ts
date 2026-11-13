// The elder's position while the app is open: when one is due (native/src/lib/shareLocation.ts).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/currentPosition', () => ({ currentPosition: vi.fn(), locationPermission: vi.fn() }));
vi.mock('@/lib/battery', () => ({ batteryPct: vi.fn() }));

import { positionDue, SHARE_EVERY_MS } from '../native/src/lib/shareLocation';

describe('positionDue', () => {
  it('at once the first time, then every 5 minutes', () => {
    const now = 1_000_000_000;
    expect(SHARE_EVERY_MS).toBe(5 * 60_000);
    expect(positionDue(now, 0)).toBe(true);
    expect(positionDue(now, now - SHARE_EVERY_MS + 1)).toBe(false);
    expect(positionDue(now, now - SHARE_EVERY_MS)).toBe(true);
  });
});
