// What an SOS / fall alert says about location (native/src/lib/alertLocationState.ts).
import { describe, expect, it } from 'vitest';
import { LOCATION_WAIT_MS, alertLocationState } from '../native/src/lib/alertLocationState';
import { SOS_LOCATION_TIMEOUT_MS } from '../native/src/lib/currentPositionTimeout';

const sos = { kind: 'sos', ageMs: 60_000, hasLocation: false, viewerMaySeeLocation: true };

describe('SOS location on the alert', () => {
  it('a position arrived: the map link', () => {
    expect(alertLocationState({ ...sos, hasLocation: true })).toBe('link');
  });
  it('none after the wait: says the location is missing (the SOS itself already went out)', () => {
    expect(alertLocationState(sos)).toBe('missing');
    expect(alertLocationState({ ...sos, kind: 'fall_detected' })).toBe('missing');
  });
  it('still within the phone\'s 10 s + upload margin: waiting, says nothing yet', () => {
    expect(alertLocationState({ ...sos, ageMs: 5_000 })).toBe('waiting');
    expect(LOCATION_WAIT_MS).toBeGreaterThan(SOS_LOCATION_TIMEOUT_MS);
    expect(SOS_LOCATION_TIMEOUT_MS).toBe(10_000);
  });
  it('a viewer who may not see location (doctors, members without it) is told nothing', () => {
    expect(alertLocationState({ ...sos, viewerMaySeeLocation: false })).toBe('none');
    expect(alertLocationState({ ...sos, viewerMaySeeLocation: null })).toBe('none');
  });
  it('other alerts: nothing about location', () => {
    expect(alertLocationState({ ...sos, kind: 'rafiq' })).toBe('none');
  });
});
