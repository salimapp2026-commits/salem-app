// Health Connect on the elder's Android phone: ask once, then sync whenever the
// app opens or comes back to the front. Read only. The rows go to hc_ingest()
// (step31a) in Rafiq's shape (lib/hcRows.ts). They never trigger an SOS or a
// fall alert: those come only from the SOS button and Salem Band events.
//
// The last 48 h are read again on every sync because band apps (Mi Fitness,
// Samsung Health…) often write an hour in late; the database keeps one row per
// moment and updates it. The first sync reads up to 30 days.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import {
  SdkAvailabilityStatus,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  insertRecords,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
} from 'react-native-health-connect';
import { supabase } from '@/lib/supabase';
import { chunks, hcRows, syncWindow } from '@/lib/hcRows';

export type HcAvailability = 'available' | 'needs_install' | 'unsupported';
type ReadType = 'HeartRate' | 'Steps' | 'OxygenSaturation' | 'SleepSession';

const READ: ReadType[] = ['HeartRate', 'Steps', 'OxygenSaturation', 'SleepSession'];
const LAST_SYNC_KEY = 'salem.hc.lastSyncMs';
const testTools = (NativeModules.SalemApp?.testTools as boolean | undefined) === true;

export async function hcAvailability(): Promise<HcAvailability> {
  if (Platform.OS !== 'android') return 'unsupported';
  try {
    const s = await getSdkStatus();
    if (s === SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
    if (s === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs_install';
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

let ready: Promise<boolean> | null = null;
const init = () => (ready ??= initialize().catch(() => false));

/** Heart rate and steps are the minimum Rafiq needs; oxygen and sleep make it better. */
export async function hcConnected(): Promise<boolean> {
  if ((await hcAvailability()) !== 'available' || !(await init())) return false;
  const granted = await getGrantedPermissions().catch(() => []);
  const has = (t: string) => granted.some((p) => p.accessType === 'read' && p.recordType === t);
  return has('HeartRate') && has('Steps');
}

/** Opens Health Connect's own permission screen (the elder chooses what to allow). */
export async function hcConnect(): Promise<boolean> {
  if (!(await init())) return false;
  await requestPermission([
    ...READ.map((recordType) => ({ accessType: 'read' as const, recordType })),
    { accessType: 'read', recordType: 'BackgroundAccessPermission' },
    { accessType: 'read', recordType: 'ReadHealthDataHistory' },
    ...(testTools
      ? (['HeartRate', 'Steps'] as const).map((recordType) => ({ accessType: 'write' as const, recordType }))
      : []),
  ]);
  return hcConnected();
}

export const hcOpenSettings = () => openHealthConnectSettings();

export async function hcLastSync(): Promise<number | null> {
  const v = await AsyncStorage.getItem(LAST_SYNC_KEY).catch(() => null);
  return v ? Number(v) : null;
}

async function readAll(type: ReadType, fromMs: number, toMs: number) {
  const out: unknown[] = [];
  let pageToken: string | undefined;
  do {
    const r = await readRecords(type, {
      timeRangeFilter: { operator: 'between', startTime: new Date(fromMs).toISOString(), endTime: new Date(toMs).toISOString() },
      pageSize: 1000,
      pageToken,
    });
    out.push(...r.records);
    pageToken = r.pageToken || undefined;
  } while (pageToken);
  return out;
}

let running: Promise<number> | null = null;

/** Reads the window, sends it, remembers the time. Returns rows written. One sync at a time. */
export function hcSync(): Promise<number> {
  running ??= (async () => {
    try {
      if (!(await hcConnected())) return 0;
      const now = Date.now();
      const { fromMs, toMs } = syncWindow(await hcLastSync(), now);
      // Sleep sessions that began before the window still mark the night as resting.
      const [heartRate, steps, oxygen, sleep] = await Promise.all([
        readAll('HeartRate', fromMs, toMs),
        readAll('Steps', fromMs, toMs),
        readAll('OxygenSaturation', fromMs, toMs).catch(() => []),
        readAll('SleepSession', fromMs - 86_400_000, toMs).catch(() => []),
      ]);
      const rows = hcRows({ heartRate, steps, oxygen, sleep } as Parameters<typeof hcRows>[0], now);
      let written = 0;
      for (const part of chunks(rows)) {
        const { data, error } = await supabase.rpc('hc_ingest', { p_rows: part });
        if (error) throw new Error(error.message);
        written += Number((data as { written?: number } | null)?.written ?? 0);
      }
      await AsyncStorage.setItem(LAST_SYNC_KEY, String(now)).catch(() => {});
      return written;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Emulator test builds only: two days of plausible band readings, written into Health Connect. */
export async function hcWriteTestReadings(): Promise<number> {
  if (!testTools) return 0;
  const end = Math.floor(Date.now() / 600_000) * 600_000;
  const start = end - 2 * 86_400_000;
  const samples: { time: string; beatsPerMinute: number }[] = [];
  const steps: { recordType: 'Steps'; startTime: string; endTime: string; count: number }[] = [];
  for (let t = start; t < end; t += 300_000) {
    const h = new Date(t + 7_200_000).getUTCHours();   // Cairo
    const night = h >= 22 || h < 7;
    samples.push({ time: new Date(t).toISOString(), beatsPerMinute: night ? 58 + (t % 3) : 70 + (t % 5) });
    if (!night && h % 3 === 0) {
      steps.push({ recordType: 'Steps', startTime: new Date(t).toISOString(), endTime: new Date(t + 300_000).toISOString(), count: 120 });
    }
  }
  const ids: string[] = [];
  for (let i = 0; i < samples.length; i += 12) {
    const part = samples.slice(i, i + 12);
    ids.push(...(await insertRecords([{
      recordType: 'HeartRate', startTime: part[0].time,
      endTime: new Date(Date.parse(part.at(-1)!.time) + 1000).toISOString(), samples: part,
    }])));
  }
  if (steps.length) ids.push(...(await insertRecords(steps)));
  return ids.length;
}
