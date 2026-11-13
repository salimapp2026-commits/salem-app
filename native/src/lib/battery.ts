// This phone's battery for the caregiver's location screen ("Device battery"), sent
// with each location ping (shareLocation.ts). Android: SalemLocationModule.battery,
// no permission needed. iOS: null until the iOS location work (like currentPosition).
import { NativeModules, Platform } from 'react-native';
import { toBatteryPct } from '@/lib/batteryValue';

const native = NativeModules.SalemLocation as { battery?(): Promise<number | null> } | undefined;

/** Best effort: null when unknown, never throws. */
export async function batteryPct(): Promise<number | null> {
  if (Platform.OS !== 'android' || !native?.battery) return null;
  try {
    return toBatteryPct(await native.battery());
  } catch {
    return null;
  }
}
