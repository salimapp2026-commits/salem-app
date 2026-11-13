// What the home "Trends" card says, from Rafiq's own tables (rafiq_scores,
// rafiq_alerts, rafiq_config). Pure — no imports — so the Expo app, the native
// app (an identical copy in native/src/lib) and the tests share one rule.
//
// Order of what wins: no readings yet → something open to look at → readings
// stopped arriving → still learning (day x of N) → watch → all usual.

export type CardScore = {
  scored_for: string;                               // YYYY-MM-DD, the elder's local day
  level: 'normal' | 'watch' | 'alert' | 'urgent';
  learning: boolean;
  reasons: { code: string; level: string; en: string; ar: string }[];
  deviations?: { agg?: Record<string, number | null> } | null;
};
export type CardAlert = { status: 'open' | 'acknowledged' | 'resolved'; reason_en: string; reason_ar: string };

export type CardState =
  | { state: 'no_data' }
  | { state: 'attention'; n: number; preview: { en: string; ar: string } | null }
  | { state: 'stale'; lastDay: string }
  | { state: 'learning'; day: number; of: number }
  | { state: 'watch'; preview: { en: string; ar: string } | null }
  | { state: 'usual' };

/** Days without a new score before the card says readings stopped arriving. */
export const STALE_AFTER_DAYS = 3;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * @param scores  daily scores, newest first (any number; 35 covers the learning window)
 * @param alerts  the elder's Rafiq alerts the viewer may see (empty for an elder)
 * @param config  rafiq_config values; learning_min_days and min_wear_hours_day are used
 * @param today   the viewer's local date, YYYY-MM-DD
 */
export function rafiqCardState(
  scores: CardScore[],
  alerts: CardAlert[],
  config: Record<string, number>,
  today: string,
): CardState {
  const latest = scores[0];
  if (!latest) return { state: 'no_data' };

  const open = alerts.filter((a) => a.status !== 'resolved');
  if (open.length || latest.level === 'alert' || latest.level === 'urgent') {
    const first = open[0];
    const reason = latest.reasons.find((r) => r.level === 'alert' || r.level === 'urgent') ?? latest.reasons[0];
    const preview = first ? { en: first.reason_en, ar: first.reason_ar } : reason ? { en: reason.en, ar: reason.ar } : null;
    return { state: 'attention', n: Math.max(open.length, 1), preview };
  }

  if (daysBetween(latest.scored_for, today) > STALE_AFTER_DAYS) return { state: 'stale', lastDay: latest.scored_for };

  if (latest.learning) {
    const of = config.learning_min_days ?? 14;
    const minWear = config.min_wear_hours_day ?? 8;
    // Days worn long enough, as the scorer counts them (core.ts isLearning).
    const worn = scores.filter((s) => (s.deviations?.agg?.wear ?? 0) >= minWear).length;
    return { state: 'learning', day: Math.min(Math.max(worn, 1), of), of };
  }

  if (latest.level === 'watch') {
    const r = latest.reasons[0];
    return { state: 'watch', preview: r ? { en: r.en, ar: r.ar } : null };
  }
  return { state: 'usual' };
}
