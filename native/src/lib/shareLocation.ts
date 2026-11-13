// The elder's position for the caregiver's map, while the app is open (founder,
// 2026-11-04): at most every 5 minutes, only with the "while using the app"
// permission the elder already gave for SOS — never asks, never in the background.
// Saved with record_location_ping (source 'fg'), with the phone's battery; the map reads
// elder_live_location, which only members with the location permission may call (never doctors).
import { supabase } from '@/lib/supabase';
import { batteryPct } from '@/lib/battery';
import { currentPosition, locationPermission } from '@/lib/currentPosition';

export const SHARE_EVERY_MS = 5 * 60_000;
const FIX_TIMEOUT_MS = 10_000;

let lastSent = 0;
let inFlight = false;

/** True when a position is due: never sent, or the last one is at least `every` old. */
export function positionDue(now: number, last: number, every = SHARE_EVERY_MS): boolean {
  return last === 0 || now - last >= every;
}

/** Sends this phone's position if one is due. Quiet on every failure: no permission,
 *  location off, no fix in 10 s, no network — the next tick tries again. */
export async function sharePositionIfDue(now = Date.now()): Promise<boolean> {
  if (inFlight || !positionDue(now, lastSent)) return false;
  inFlight = true;
  try {
    if ((await locationPermission()) !== 'granted') return false;
    const [pos, battery] = await Promise.all([currentPosition(FIX_TIMEOUT_MS), batteryPct()]);
    if (!pos) return false;
    const { error } = await supabase.rpc('record_location_ping', {
      p_lat: pos.lat,
      p_lon: pos.lon,
      p_accuracy_m: pos.accuracy_m,
      p_battery_pct: battery,
      p_source: 'fg',
    });
    if (error) return false;
    lastSent = now;
    return true;
  } catch {
    return false;
  } finally {
    inFlight = false;
  }
}

/** After a sign-out, the next elder on this phone starts fresh. */
export function resetShareLocation() {
  lastSent = 0;
}
