// What an SOS / fall alert shows about location. Pure, so it can be tested.
//
//   'link'    a position is there → "Last known location" / "Location update"
//   'waiting' the phone may still send one (SOS_LOCATION_TIMEOUT_MS + upload margin)
//   'missing' none came → say so, so family call instead of waiting for a map
//   'none'    not an emergency, or this viewer may not see location (doctors never do)

/** The phone gives up after 10 s; allow 20 s more for the upload on a slow network. */
export const LOCATION_WAIT_MS = 30_000;

export type AlertLocationState = 'link' | 'waiting' | 'missing' | 'none';

export function alertLocationState(a: {
  kind: string;
  ageMs: number;
  hasLocation: boolean;
  viewerMaySeeLocation: boolean | null;   // null = still checking
}): AlertLocationState {
  if (a.kind !== 'sos' && a.kind !== 'fall_detected') return 'none';
  if (a.hasLocation) return 'link';
  if (a.viewerMaySeeLocation !== true) return 'none';
  return a.ageMs < LOCATION_WAIT_MS ? 'waiting' : 'missing';
}
