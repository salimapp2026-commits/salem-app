// The elder home shows real data only: today's doses and the one to ask about,
// stats from real readings (pressure hidden without one), the care circle.
import { describe, expect, it } from 'vitest';
import {
  adherenceToday, bandBadge, barHeights, circleCorners, dialable, elderDoses, elderStats, initials,
} from '../native/src/lib/elderHome';

const NOW = Date.parse('2026-11-05T10:00:00Z');
const ev = (id: number, hhmm: string, status: 'pending' | 'done' | 'skipped' | 'snoozed' | 'missed', title = `Med ${id}`) =>
  ({ id, scheduled_at: `2026-11-05T${hhmm}:00.000Z`, status, title });

describe('elder home: medication', () => {
  it('taken, due and later doses in time order; asks about the earliest due one', () => {
    const r = elderDoses([ev(3, '14:00', 'pending'), ev(1, '08:00', 'done'), ev(2, '09:30', 'pending'), ev(4, '09:45', 'snoozed')], NOW);
    expect(r.doses.map((d) => [d.id, d.state])).toEqual([[1, 'taken'], [2, 'due'], [4, 'due'], [3, 'later']]);
    expect(r.ask?.id).toBe(2);
    expect(r.allTaken).toBe(false);
  });
  it('all taken → the green card, nothing to ask', () => {
    const r = elderDoses([ev(1, '08:00', 'done'), ev(2, '09:00', 'done')], NOW);
    expect(r.allTaken).toBe(true);
    expect(r.ask).toBeNull();
  });
  it('no doses today: not "all taken", nothing to ask', () => {
    expect(elderDoses([], NOW)).toEqual({ doses: [], ask: null, allTaken: false });
  });
  it('skipped and missed doses are shown as such, never as taken, and not asked again', () => {
    const r = elderDoses([ev(1, '08:00', 'skipped'), ev(2, '09:00', 'missed')], NOW);
    expect(r.doses.map((d) => d.state)).toEqual(['skipped', 'missed']);
    expect(r.ask).toBeNull();
    expect(r.allTaken).toBe(false);
  });
});

describe('elder home: stat cards', () => {
  const hr = (v: number, min: number) => ({ kind: 'heart_rate', value_numeric: v, captured_at: new Date(NOW - min * 60_000).toISOString(), source: 'band' });
  it('heart rate: the newest value; bars oldest → newest, at most 9', () => {
    const s = elderStats({ heartRates: Array.from({ length: 12 }, (_, i) => hr(70 + i, i)), pressure: null, stepsToday: [], lastBand: null, lastHcSyncAt: null }, NOW);
    expect(s.heartRate?.bpm).toBe(70);
    expect(s.heartRate?.bars).toEqual([78, 77, 76, 75, 74, 73, 72, 71, 70]);
  });
  it('pressure: hidden unless a real blood-pressure reading exists — never a sample 120/80', () => {
    expect(elderStats({ heartRates: [], pressure: null, stepsToday: [], lastBand: null, lastHcSyncAt: null }, NOW).pressure).toBeNull();
    const bp = { kind: 'blood_pressure', value_numeric: null, value_systolic: 131, value_diastolic: 84, captured_at: '2026-11-04T08:00:00Z' };
    expect(elderStats({ heartRates: [], pressure: bp, stepsToday: [], lastBand: null, lastHcSyncAt: null }, NOW).pressure)
      .toEqual({ systolic: 131, diastolic: 84, at: '2026-11-04T08:00:00Z' });
  });
  it('steps: today\'s rows summed; none → null (the card says so)', () => {
    const st = (v: number) => ({ kind: 'steps', value_numeric: v, captured_at: '2026-11-05T09:00:00Z' });
    expect(elderStats({ heartRates: [], pressure: null, stepsToday: [st(120.4), st(300), st(0)], lastBand: null, lastHcSyncAt: null }, NOW).steps).toBe(420);
    expect(elderStats({ heartRates: [], pressure: null, stepsToday: [], lastBand: null, lastHcSyncAt: null }, NOW).steps).toBeNull();
  });
  it('band badge: "band is connected" only for a Salem Band reading in the last 3 hours', () => {
    const at = (min: number, source: string) => ({ kind: 'heart_rate', value_numeric: 70, captured_at: new Date(NOW - min * 60_000).toISOString(), source });
    expect(bandBadge(at(30, 'band'), null, NOW)).toEqual({ kind: 'connected' });
    expect(bandBadge(at(170, 'band'), null, NOW)).toEqual({ kind: 'connected' });
    expect(bandBadge(at(190, 'band'), null, NOW)).toEqual({ kind: 'silent' });
    expect(bandBadge(at(5, 'manual'), null, NOW)).toEqual({ kind: 'none' });
    expect(bandBadge(null, null, NOW)).toEqual({ kind: 'none' });
  });
  it('band badge: Health Connect elders see "Last sync", neutral, however old (it syncs when the app opens)', () => {
    const sync = new Date(NOW - 20 * 3_600_000).toISOString();
    expect(bandBadge(null, sync, NOW)).toEqual({ kind: 'hc_sync', at: sync });
    // a live Salem Band wins; a silent one does not hide the Health Connect sync
    const band = (min: number) => ({ kind: 'heart_rate', value_numeric: 70, captured_at: new Date(NOW - min * 60_000).toISOString(), source: 'band' });
    expect(bandBadge(band(10), sync, NOW)).toEqual({ kind: 'connected' });
    expect(bandBadge(band(600), sync, NOW)).toEqual({ kind: 'hc_sync', at: sync });
  });
  it('bar heights between 8 and 28 like the design', () => {
    expect(barHeights([60, 70, 80])).toEqual([8, 18, 28]);
    expect(barHeights([70, 70])).toEqual([18, 18]);
  });
});

describe('elder home: care circle', () => {
  it('the primary caretaker before other family; the doctor; numbers only if dialable', () => {
    const c = circleCorners([
      { member_role: 'family', display_name: 'Omar', phone_e164: null },
      { member_role: 'doctor', display_name: 'Dr Hany', phone_e164: '+20 100 123 4567' },
      { member_role: 'primary_caretaker', display_name: 'Mona Adel', phone_e164: '+201001112222' },
    ]);
    expect(c.caregiver?.display_name).toBe('Mona Adel');
    expect(c.doctor?.display_name).toBe('Dr Hany');
    expect(dialable(c.doctor?.phone_e164)).toBe('+201001234567');
    expect(dialable(null)).toBeNull();
    expect(dialable('call me')).toBeNull();
    expect(initials('Mona Adel', 'Cg')).toBe('MA');
    expect(initials('', 'Cg')).toBe('Cg');
    expect(circleCorners([])).toEqual({ caregiver: null, doctor: null });
  });
});

describe('caregiver home: adherence today', () => {
  it('taken doses out of all of today\'s doses; none scheduled → null, never "0 %"', () => {
    expect(adherenceToday([ev(1, '08:00', 'done'), ev(2, '09:00', 'done'), ev(3, '12:00', 'done'), ev(4, '21:00', 'pending')]))
      .toEqual({ done: 3, total: 4, pct: 75 });
    expect(adherenceToday([ev(1, '08:00', 'skipped')])).toEqual({ done: 0, total: 1, pct: 0 });
    expect(adherenceToday([])).toBeNull();
  });
});
