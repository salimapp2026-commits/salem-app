// The phone's battery sent with each location ping (native/src/lib/batteryValue.ts).
import { describe, expect, it } from 'vitest';

import { toBatteryPct } from '../native/src/lib/batteryValue';

describe('toBatteryPct', () => {
  it('keeps a whole percent 0–100', () => {
    expect(toBatteryPct(0)).toBe(0);
    expect(toBatteryPct(64)).toBe(64);
    expect(toBatteryPct(99.6)).toBe(100);
    expect(toBatteryPct(100)).toBe(100);
  });

  it('anything else is unknown', () => {
    expect(toBatteryPct(-1)).toBeNull();
    expect(toBatteryPct(101)).toBeNull();
    expect(toBatteryPct(Number.NaN)).toBeNull();
    expect(toBatteryPct(null)).toBeNull();
    expect(toBatteryPct('64')).toBeNull();
  });
});
