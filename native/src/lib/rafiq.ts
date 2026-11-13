// Rafiq data for the insights screen. Everything is read through row-level
// security: the elder sees their own rows, caregivers with read-health and
// linked doctors see the elder's (has_perm(elder, 'health')). No location is
// stored in any Rafiq table.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DailyPoint } from '@/lib/trends';
import type { Level } from '@/supabase/functions/_shared/rafiq/core';
import { type CardAlert, type CardScore, rafiqCardState } from '@/lib/rafiqCard';

export type RafiqMetricKey = 'hr_night' | 'spo2_night' | 'temp_night' | 'steps';

/** The four readings the screen shows, in order. `reason` is the Rafiq reason about it. */
export const RAFIQ_METRICS: {
  key: RafiqMetricKey;
  reason: string;
  label: string;
  unit: string;
  decimals: number;
  relative: boolean;          // shown as a share of the person's usual
  icon: 'heart' | 'wind' | 'thermometer' | 'activity';
}[] = [
  { key: 'hr_night', reason: 'resting_hr_up', label: 'Resting heart rate at night', unit: 'bpm', decimals: 0, relative: false, icon: 'heart' },
  { key: 'spo2_night', reason: 'spo2_night_down', label: 'Oxygen at night', unit: '%', decimals: 0, relative: false, icon: 'wind' },
  { key: 'temp_night', reason: 'temp_up', label: 'Skin temperature at night', unit: '°C', decimals: 1, relative: false, icon: 'thermometer' },
  { key: 'steps', reason: 'activity_down', label: 'Activity', unit: '% of usual', decimals: 0, relative: true, icon: 'activity' },
];

export type RafiqReasonRow = { code: string; level: Level; days: number; en: string; ar: string };
export type RafiqScore = {
  scored_for: string;
  level: Level;
  learning: boolean;
  model_score: number | null;
  reasons: RafiqReasonRow[];
  deviations: {
    z: Record<string, number | null>;
    agg: Record<string, number | null>;
    base: Record<string, [number, number] | null>;
  };
};
export type RafiqBaseline = {
  metric: string; median: number | null; robust_sd: number | null; relative: boolean;
  low: number | null; high: number | null; learning: boolean; computed_for: string | null;
};
export type RafiqAlert = {
  id: string; level: Level; reason_code: string; reason_en: string; reason_ar: string;
  status: 'open' | 'acknowledged' | 'resolved'; opened_at: string; days: number; acknowledged_at: string | null;
};

/** Daily verdicts, newest first (35 days covers the month view). */
export function useRafiqScores(elderId: string | undefined, days = 35) {
  return useQuery<RafiqScore[]>({
    queryKey: ['rafiq_scores', elderId, days],
    enabled: !!elderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rafiq_scores')
        .select('scored_for, level, learning, model_score, reasons, deviations')
        .eq('elder_id', elderId!)
        .eq('scope', 'day')
        .order('scored_for', { ascending: false })
        .limit(days);
      if (error) throw error;
      return (data ?? []) as RafiqScore[];
    },
  });
}

export function useRafiqBaselines(elderId: string | undefined) {
  return useQuery<Record<string, RafiqBaseline>>({
    queryKey: ['rafiq_baselines', elderId],
    enabled: !!elderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rafiq_baselines')
        .select('metric, median, robust_sd, relative, low, high, learning, computed_for')
        .eq('elder_id', elderId!);
      if (error) throw error;
      return Object.fromEntries(((data ?? []) as RafiqBaseline[]).map((b) => [b.metric, b]));
    },
  });
}

export function useRafiqAlerts(elderId: string | undefined, enabled = true) {
  return useQuery<RafiqAlert[]>({
    queryKey: ['rafiq_alerts', elderId],
    enabled: !!elderId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rafiq_alerts')
        .select('id, level, reason_code, reason_en, reason_ar, status, opened_at, days, acknowledged_at')
        .eq('elder_id', elderId!)
        .order('opened_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as RafiqAlert[];
    },
  });
}

export function useAcknowledgeRafiqAlert(elderId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('acknowledge_rafiq_alert', { p_rafiq_alert: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rafiq_alerts', elderId] }),
  });
}

/** One metric's daily values for the charts, oldest first, in the unit shown on screen. */
export function metricPoints(scores: RafiqScore[], key: RafiqMetricKey, median: number | null, relative: boolean): DailyPoint[] {
  return [...scores].reverse().map((s) => {
    const v = s.deviations?.agg?.[key];
    const value = v == null ? NaN : relative ? (median ? (v / median) * 100 : NaN) : v;
    return { day: s.scored_for, value: Number.isFinite(value) ? value : 0, enough: Number.isFinite(value) };
  });
}

/** The usual range in the unit shown on screen. */
export function usualRange(b: RafiqBaseline | undefined, relative: boolean) {
  if (!b || b.median == null || b.robust_sd == null) return { low: null, high: null, median: null };
  if (relative) return { low: Math.max(0, 100 * (1 - 2 * b.robust_sd)), high: 100 * (1 + 2 * b.robust_sd), median: 100 };
  return { low: b.low, high: b.high, median: b.median };
}

/** The level a metric is at today: the matching reason's level, else normal. */
export function metricLevel(score: RafiqScore | undefined, reason: string): Level {
  const r = score?.reasons?.find((x) => x.code === reason);
  return r ? r.level : 'normal';
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The home card's state (lib/rafiqCard.ts) from the newest scores, the open alerts and rafiq_config. */
export function useRafiqCard(elderId: string | undefined) {
  return useQuery({
    queryKey: ['rafiq_card', elderId],
    enabled: !!elderId,
    queryFn: async () => {
      const [s, a, c] = await Promise.all([
        supabase.from('rafiq_scores').select('scored_for, level, learning, reasons, deviations')
          .eq('elder_id', elderId!).eq('scope', 'day').order('scored_for', { ascending: false }).limit(35),
        supabase.from('rafiq_alerts').select('status, reason_en, reason_ar')
          .eq('elder_id', elderId!).in('status', ['open', 'acknowledged']).order('opened_at', { ascending: false }),
        supabase.from('rafiq_config').select('key, value').in('key', ['learning_min_days', 'min_wear_hours_day']),
      ]);
      if (s.error) throw s.error;
      if (a.error) throw a.error;
      const config = Object.fromEntries(((c.data ?? []) as { key: string; value: number }[]).map((r) => [r.key, Number(r.value)]));
      return rafiqCardState((s.data ?? []) as CardScore[], (a.data ?? []) as CardAlert[], config, localToday());
    },
  });
}
