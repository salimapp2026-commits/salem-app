// What the elder home shows (Figma "Elder home , medication checklist& care
// circle"), from real data only. Pure — no imports — so it is tested without a
// phone (tests/elderHome.test.ts). Nothing here invents a number: a card with
// no real reading says so, and blood pressure is hidden unless one exists.

export type DoseStatus = 'pending' | 'done' | 'skipped' | 'snoozed' | 'missed';
export type DoseEvent = { id: number; scheduled_at: string; status: DoseStatus; title: string | null };

export type Dose = {
  id: number;
  title: string;
  at: string;                                   // scheduled time (ISO)
  state: 'taken' | 'due' | 'later' | 'skipped' | 'missed';
};

/** Today's medicine doses, in time order; the one to ask about ("Did you take …?"):
 *  the earliest dose that is due and not answered; and whether every dose is taken. */
export function elderDoses(events: DoseEvent[], nowMs: number): { doses: Dose[]; ask: Dose | null; allTaken: boolean } {
  const doses = [...events]
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id - b.id)
    .map((e): Dose => {
      const due = Date.parse(e.scheduled_at) <= nowMs;
      const state: Dose['state'] =
        e.status === 'done' ? 'taken'
        : e.status === 'skipped' ? 'skipped'
        : e.status === 'missed' ? 'missed'
        : due ? 'due' : 'later';
      return { id: e.id, title: (e.title ?? '').trim(), at: e.scheduled_at, state };
    });
  const ask = doses.find((d) => d.state === 'due') ?? null;
  const allTaken = doses.length > 0 && doses.every((d) => d.state === 'taken');
  return { doses, ask, allTaken };
}

export type Reading = { kind: string; value_numeric: number | null; value_systolic?: number | null;
  value_diastolic?: number | null; captured_at: string; source?: string | null };

export type ElderStats = {
  heartRate: { bpm: number; bars: number[]; at: string } | null;   // bars: oldest → newest, at most 9; at: newest
  pressure: { systolic: number; diastolic: number; at: string } | null;   // only a real reading
  steps: number | null;                                  // today so far; null = no step data today
  band: BandBadge;
};

/** The badge next to SOS (founder, 2026-11-01):
 *   connected  a Salem Band reading in the last 3 h → "● band is connected"
 *   hc_sync    readings come through Health Connect, which syncs only when the app opens,
 *              so "Last sync · {time}" in neutral styling — never a warning
 *   silent     a Salem Band that has sent nothing for 3 h → "No band readings right now"
 *   none       no band at all → no badge */
export type BandBadge = { kind: 'connected' } | { kind: 'hc_sync'; at: string } | { kind: 'silent' } | { kind: 'none' };

export const BAND_RECENT_MS = 3 * 3_600_000;
const SALEM_BAND = new Set(['band', 'watch']);

export function bandBadge(lastBand: Reading | null, lastHcSyncAt: string | null, nowMs: number): BandBadge {
  const bandRecent = !!lastBand && SALEM_BAND.has(lastBand.source ?? '') && nowMs - Date.parse(lastBand.captured_at) <= BAND_RECENT_MS;
  if (bandRecent) return { kind: 'connected' };
  if (lastHcSyncAt) return { kind: 'hc_sync', at: lastHcSyncAt };
  if (lastBand && SALEM_BAND.has(lastBand.source ?? '')) return { kind: 'silent' };
  return { kind: 'none' };
}

/** heartRates: newest first. stepsToday: today's step rows. lastBand: the newest Salem Band
 *  reading. lastHcSyncAt: when Health Connect readings last reached Salem (their created_at). */
export function elderStats(input: {
  heartRates: Reading[];
  pressure: Reading | null;
  stepsToday: Reading[];
  lastBand: Reading | null;
  lastHcSyncAt: string | null;
}, nowMs: number): ElderStats {
  const hr = input.heartRates.filter((r) => r.value_numeric !== null).slice(0, 9);
  const p = input.pressure;
  const stepRows = input.stepsToday.filter((r) => r.value_numeric !== null);
  return {
    heartRate: hr.length ? { bpm: Math.round(hr[0].value_numeric!), bars: hr.map((r) => r.value_numeric!).reverse(), at: hr[0].captured_at } : null,
    pressure: p && p.value_systolic && p.value_diastolic
      ? { systolic: p.value_systolic, diastolic: p.value_diastolic, at: p.captured_at } : null,
    steps: stepRows.length ? Math.round(stepRows.reduce((s, r) => s + r.value_numeric!, 0)) : null,
    band: bandBadge(input.lastBand, input.lastHcSyncAt, nowMs),
  };
}

/** Heights (px) of the mini chart's bars: 8–28 like the design, scaled to the readings. */
export function barHeights(values: number[], min = 8, max = 28): number[] {
  if (!values.length) return [];
  const lo = Math.min(...values), hi = Math.max(...values);
  return values.map((v) => (hi === lo ? (min + max) / 2 : min + ((v - lo) / (hi - lo)) * (max - min)));
}

export type Member = { member_role: string; display_name: string | null; phone_e164: string | null };

/** The care circle triangle: one caregiver (the primary caretaker first) and one doctor. */
export function circleCorners(members: Member[]): { caregiver: Member | null; doctor: Member | null } {
  const family = members.filter((m) => m.member_role === 'primary_caretaker' || m.member_role === 'family');
  const caregiver = family.find((m) => m.member_role === 'primary_caretaker') ?? family[0] ?? null;
  const doctor = members.find((m) => m.member_role === 'doctor') ?? null;
  return { caregiver, doctor };
}

/** Initials for an avatar: first letters of the first two words ("Mona Adel" → "MA"). */
export function initials(name: string | null | undefined, fallback: string): string {
  const w = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return fallback;
  return (w[0][0] + (w[1]?.[0] ?? '')).toUpperCase();
}

/** A phone number the dialer can take, or null (never a made-up one). */
export function dialable(phone: string | null | undefined): string | null {
  const p = (phone ?? '').replace(/[^\d+]/g, '');
  return /^\+?\d{6,15}$/.test(p) ? p : null;
}

/** "Adherence Rate Today" on the caregiver home: medicine doses taken today out of all of
 *  today's doses (null when there are none — the card says so instead of showing 0 %). */
export function adherenceToday(events: DoseEvent[]): { done: number; total: number; pct: number } | null {
  if (!events.length) return null;
  const done = events.filter((e) => e.status === 'done').length;
  return { done, total: events.length, pct: Math.round((done / events.length) * 100) };
}
