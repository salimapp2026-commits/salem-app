// Best-effort current position for an emergency. Never blocks anything: the
// SOS is sent first, and this only adds a location afterwards (add_sos_location).
//
// Android: SalemLocationModule (Fused Location, works indoors over Wi-Fi/cell),
// "while using the app" only. Gives up after ~10 s (founder, 2026-10-31); a fix
// from the last two minutes counts. No permission → null, and the alert says
// the location is missing (AlertLocationLink). iOS: CoreLocation comes later
// (docs/NATIVE_REWRITE_PLAN.md §4) — null until then.
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { t } from '@/lib/i18n';
import { SOS_LOCATION_TIMEOUT_MS } from '@/lib/currentPositionTimeout';

export type Position = { lat: number; lon: number; accuracy_m: number | null };

export { SOS_LOCATION_TIMEOUT_MS };

const native = NativeModules.SalemLocation as
  | { current(timeoutMs: number): Promise<(Position & { age_ms: number }) | null> }
  | undefined;

export async function currentPosition(timeoutMs = SOS_LOCATION_TIMEOUT_MS): Promise<Position | null> {
  if (Platform.OS !== 'android' || !native) return null;
  // The native side resolves by timeoutMs; this guard covers a module that never answers.
  const guard = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs + 1500));
  try {
    const p = await Promise.race([native.current(timeoutMs), guard]);
    return p ? { lat: p.lat, lon: p.lon, accuracy_m: p.accuracy_m ?? null } : null;
  } catch {
    return null;
  }
}

export type LocationPermission = 'granted' | 'denied' | 'unavailable';

export async function locationPermission(): Promise<LocationPermission> {
  if (Platform.OS !== 'android') return 'unavailable';
  const [fine, coarse] = await Promise.all([
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION),
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION),
  ]);
  return fine || coarse ? 'granted' : 'denied';
}

/** Ask once, with Salem's own explanation first. Android offers "While using the app" /
 *  "Only this time" / "Don't allow" — never "all the time" (not declared). */
export async function askLocationPermission(): Promise<LocationPermission> {
  if (Platform.OS !== 'android') return 'unavailable';
  const r = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  ]);
  const ok = Object.values(r).some((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  return ok ? 'granted' : 'denied';
}

/** The explanation shown before Android's own dialog. */
export const locationRationale = () => ({ title: t('sosLocation.title'), body: t('sosLocation.body') });
