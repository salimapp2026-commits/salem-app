// Trend Watch — client data layer.
//
// Everything here reads through row-level security (has_perm(elder, 'health')):
// the elder sees their own trends, caregivers and doctors with read-health see
// the elder's, everyone else gets nothing. Doctors change findings only via the
// mark_trend_expected RPC, which checks the role and writes the audit log.
//
// Wording (metric names, next steps, the elder's gentle line, the disclaimer)
// comes from the same module the server uses, so the app and the push
// messages can never drift apart.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getLocale } from '@/lib/i18n';
import {
  type Lang,
  type Metric,
  METRICS,
} from '@/supabase/functions/_shared/trendText';

export type { Metric };
export { METRICS };

export type DailyPoint = { day: string; value: number; enough: boolean };

export type TrendBaseline = {
  metric: Metric;
  median: number | null;
  low: number | null;
  high: number | null;
  learning: boolean;
  learning_day: number;
  paused_until: string | null;
};

export type TrendFinding = {
  id: string;
  metric: Metric;
  severity: 'info' | 'warning';
  status: 'open' | 'resolved' | 'marked_expected';
  baseline_value: number | null;
  current_value: number | null;
  change_value: number | null;
  days: number;
  combined: boolean;
  explanation_en: string | null;
  explanation_ar: string | null;
  next_steps: string[];
  opened_for: string;
  opened_at: string;
  resolved_at: string | null;
  expected_reason: string | null;
};

export type WeeklySummary = {
  week_start: string;
  summary_en: string;
  summary_ar: string;
};

/** The language Trend Watch text should be shown in right now. */
export function trendLang(): Lang {
  return getLocale() === 'ar' ? 'ar' : 'en';
}

export function explanationFor(f: Pick<TrendFinding, 'explanation_en' | 'explanation_ar'>): string {
  return (trendLang() === 'ar' ? f.explanation_ar : f.explanation_en) ?? f.explanation_en ?? '';
}

export function useTrendOverview(elderId: string | null | undefined) {
  return useQuery({
    queryKey: ['trend-overview', elderId],
    enabled: !!elderId,
    queryFn: async () => {
      const [b, f, w] = await Promise.all([
        supabase
          .from('trend_baselines')
          .select('metric, median, low, high, learning, learning_day, paused_until')
          .eq('elder_id', elderId!),
        supabase
          .from('trend_findings')
          .select(
            'id, metric, severity, status, baseline_value, current_value, change_value, days, combined, ' +
              'explanation_en, explanation_ar, next_steps, opened_for, opened_at, resolved_at, expected_reason',
          )
          .eq('elder_id', elderId!)
          .order('opened_at', { ascending: false })
          .limit(30),
        supabase
          .from('trend_weekly_summaries')
          .select('week_start, summary_en, summary_ar')
          .eq('elder_id', elderId!)
          .order('week_start', { ascending: false })
          .limit(1),
      ]);
      if (b.error) throw b.error;
      if (f.error) throw f.error;
      if (w.error) throw w.error;
      const baselines = (b.data ?? []) as unknown as TrendBaseline[];
      const findings = (f.data ?? []) as unknown as TrendFinding[];
      const open = findings.filter((x) => x.status === 'open');
      // Learning = every metric that has data is still learning.
      const learning = baselines.length > 0 && baselines.every((x) => x.learning);
      const learningDay = baselines.reduce((m, x) => Math.max(m, x.learning_day ?? 0), 0);
      return {
        baselines,
        findings,
        open,
        weekly: ((w.data ?? []) as WeeklySummary[])[0] ?? null,
        state: (baselines.length === 0 ? 'no_data' : learning ? 'learning' : open.length ? 'changes' : 'usual') as
          | 'no_data'
          | 'learning'
          | 'changes'
          | 'usual',
        learningDay,
      };
    },
  });
}

/** Daily values for the charts: the last `days` days, every metric. */
export function useTrendSeries(elderId: string | null | undefined, days = 28) {
  return useQuery({
    queryKey: ['trend-series', elderId, days],
    enabled: !!elderId,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('vital_daily_summaries')
        .select('metric, day, value, enough')
        .eq('elder_id', elderId!)
        .gte('day', since)
        .order('day');
      if (error) throw error;
      const by = new Map<Metric, DailyPoint[]>();
      for (const r of (data ?? []) as { metric: Metric; day: string; value: number; enough: boolean }[]) {
        if (!by.has(r.metric)) by.set(r.metric, []);
        by.get(r.metric)!.push({ day: r.day, value: Number(r.value), enough: r.enough });
      }
      return by;
    },
  });
}

/** Doctors only (enforced in the database). Pauses the metric 14 days. */
export async function markTrendExpected(findingId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('mark_trend_expected', {
    p_finding_id: findingId,
    p_reason: reason,
  });
  if (error) throw error;
}
