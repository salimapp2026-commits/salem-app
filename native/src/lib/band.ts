// Salem Band — data hooks and small helpers shared by the caregiver, doctor
// and elder screens. Everything here works on web: the band's data reaches the
// server through band-ingest (phone app, or scripts/band/simulate.ts today),
// and these screens only read it back.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatTime, t, tf } from '@/lib/i18n';

export type BandStatus =
  | { paired: false }
  | {
      paired: true;
      serial_last4: string;
      model: string | null;
      firmware_version: string | null;
      battery_pct: number | null;
      is_charging: boolean;
      worn: boolean | null;
      worn_changed_at: string | null;
      last_upload_at: string | null;
      last_record_at: string | null;
      paired_at: string;
      worn_minutes_today: number;
      pending_fall: { id: string; respond_by: string; occurred_at: string | null } | null;
      server_time: string;
    };

/** band_status() for an elder (the elder themself, or anyone with read-health). */
export function useBandStatus(
  elderId: string | undefined,
  opts: { refetchMs?: number | ((last: BandStatus | undefined) => number) } = {},
) {
  const every = opts.refetchMs ?? 60_000;
  return useQuery<BandStatus>({
    queryKey: ['band_status', elderId],
    enabled: !!elderId,
    refetchInterval: (q) => (typeof every === 'function' ? every(q.state.data) : every),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('band_status', { p_elder_id: elderId });
      if (error) throw error;
      return data as BandStatus;
    },
  });
}

/** "just now" / "12 min ago" / "3 h ago" / "2 d ago". */
export function agoLabel(iso: string, nowMs = Date.now()): string {
  const min = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60_000));
  if (min < 1) return t('band.agoNow');
  if (min < 60) return tf('band.agoMin', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return tf('band.agoHour', { n: h });
  return tf('band.agoDay', { n: Math.round(h / 24) });
}

export type SyncState = 'fresh' | 'stale' | 'quiet' | 'never';

/** fresh < 15 min, stale < 12 h, quiet ≥ 12 h (the server's no-data rule). */
export function syncState(s: Extract<BandStatus, { paired: true }>, nowMs = Date.now()): SyncState {
  if (!s.last_upload_at) return 'never';
  const min = (nowMs - new Date(s.last_upload_at).getTime()) / 60_000;
  if (min < 15) return 'fresh';
  if (min < 12 * 60) return 'stale';
  return 'quiet';
}

/**
 * Today's step total from the band (one STEPS record per 10-minute block).
 * The latest single row would only be the last 10 minutes. Uses this device's
 * midnight, which matches the elder's in the usual same-timezone case.
 */
export function useBandStepsToday(elderId: string | undefined, enabled = true) {
  return useQuery<number>({
    queryKey: ['band_steps_today', elderId],
    enabled: !!elderId && enabled,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('vitals')
        .select('value_numeric')
        .eq('elder_id', elderId!)
        .eq('kind', 'steps')
        .eq('source', 'band')
        .gte('captured_at', since.toISOString())
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as { value_numeric: number | null }[]).reduce((n, r) => n + (r.value_numeric ?? 0), 0);
    },
  });
}

// ------------------------------------------------------------------ readings
type ReadingLike = { source?: string | null; kind?: string; quality?: number | null };

export const BAND_QUALITY_MIN = 60; // mirrors trend_config.band_quality_min

export function isBandReading(v: ReadingLike | null | undefined): boolean {
  return v?.source === 'band';
}

/** Low-quality band HR / SpO2: stored, but not used for alerts or trends. */
export function isWeakSignal(v: ReadingLike | null | undefined): boolean {
  return (
    isBandReading(v) &&
    (v!.kind === 'heart_rate' || v!.kind === 'spo2') &&
    (v!.quality ?? 0) < BAND_QUALITY_MIN
  );
}

// ------------------------------------------------------------------ alerts
type AlertLike = { kind: string; payload?: Record<string, unknown> | null };

export function isBandAlert(a: AlertLike): boolean {
  return a.payload?.source === 'band';
}

/**
 * The line under a band alert: "From the Salem Band · Delayed: happened at
 * 07:00", "… · Time unknown", "… · Asked for help". Empty for other alerts.
 */
export function bandAlertNote(a: AlertLike): string {
  if (!isBandAlert(a)) return '';
  const p = a.payload ?? {};
  const parts = [t('alerts.fromBand')];
  if (p.time_unknown === true) parts.push(t('alerts.timeUnknown'));
  else if (p.delayed === true && typeof p.occurred_at === 'string') {
    // The elder's own HH:MM is in delayed_label; this device's clock is used
    // only if that's missing.
    const time = typeof p.delayed_label === 'string' ? p.delayed_label : formatTime(p.occurred_at);
    parts.push(tf('alerts.delayed', { time }));
  }
  if (p.unconfirmed === true) parts.push(t('alerts.unconfirmed'));
  if (p.resolution === 'elder_help') parts.push(t('alerts.askedForHelp'));
  if (p.resolution === 'timeout') parts.push(t('alerts.noAnswer'));
  return parts.join(' · ');
}

/** Fixed text written by the server for band SOS / fall / info alerts. */
export function bandAlertText(a: AlertLike): string | null {
  const body = a.payload?.body_en;
  return isBandAlert(a) && typeof body === 'string' ? body : null;
}

export function bandKindLabel(kind: string): string | null {
  if (kind === 'band_off_wrist') return t('alerts.kind.band_off_wrist');
  if (kind === 'band_no_data') return t('alerts.kind.band_no_data');
  return null;
}
