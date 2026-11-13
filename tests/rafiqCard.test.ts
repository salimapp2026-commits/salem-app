// The home "Trends" card reads Rafiq, not Trend Watch: what it says for each
// situation a caregiver can be in.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CardAlert, type CardScore, rafiqCardState } from '../native/src/lib/rafiqCard';

const ROOT = join(__dirname, '..');
const cfg = { learning_min_days: 14, min_wear_hours_day: 8 };
const TODAY = '2026-11-10';

function score(day: string, level: CardScore['level'] = 'normal', learning = false, wear = 20, reasons: CardScore['reasons'] = []): CardScore {
  return { scored_for: day, level, learning, reasons, deviations: { agg: { wear } } };
}
const temp = { code: 'temp_up', level: 'alert', en: 'Skin temperature higher', ar: 'حرارة الجلد أعلى' };
const act = { code: 'activity_down', level: 'watch', en: 'Less active', ar: 'نشاط أقل' };
const open: CardAlert = { status: 'open', reason_en: 'Fever-like change', reason_ar: 'تغيّر يشبه الحمّى' };

describe('home Trends card (Rafiq)', () => {
  it('no scores yet: no data', () => {
    expect(rafiqCardState([], [], cfg, TODAY)).toEqual({ state: 'no_data' });
  });

  it('learning: day x of N, counting only days worn long enough', () => {
    const s = [score('2026-11-09', 'normal', true), score('2026-11-08', 'normal', true, 3), score('2026-11-07', 'normal', true)];
    expect(rafiqCardState(s, [], cfg, TODAY)).toEqual({ state: 'learning', day: 2, of: 14 });
  });

  it('learning: N comes from rafiq_config (7 for the beta), never shown past N', () => {
    const s = Array.from({ length: 9 }, (_, i) => score(`2026-11-0${9 - i}`, 'normal', true));
    expect(rafiqCardState(s, [], { ...cfg, learning_min_days: 7 }, TODAY)).toEqual({ state: 'learning', day: 7, of: 7 });
  });

  it('all usual', () => {
    expect(rafiqCardState([score('2026-11-09')], [], cfg, TODAY)).toEqual({ state: 'usual' });
  });

  it('watch shows the reason in both languages', () => {
    expect(rafiqCardState([score('2026-11-09', 'watch', false, 20, [act])], [], cfg, TODAY))
      .toEqual({ state: 'watch', preview: { en: act.en, ar: act.ar } });
  });

  it('an open or seen alert wins, even on a usual day; resolved ones do not count', () => {
    const resolved: CardAlert = { ...open, status: 'resolved' };
    const seen: CardAlert = { ...open, status: 'acknowledged' };
    expect(rafiqCardState([score('2026-11-09')], [open, seen, resolved], cfg, TODAY))
      .toEqual({ state: 'attention', n: 2, preview: { en: open.reason_en, ar: open.reason_ar } });
    expect(rafiqCardState([score('2026-11-09')], [resolved], cfg, TODAY)).toEqual({ state: 'usual' });
  });

  it('an alert-level day with no alert row (the elder\'s own view) still asks for attention', () => {
    expect(rafiqCardState([score('2026-11-09', 'alert', false, 20, [act, temp])], [], cfg, TODAY))
      .toEqual({ state: 'attention', n: 1, preview: { en: temp.en, ar: temp.ar } });
  });

  it('readings stopped arriving (> 3 days): says so instead of "all usual"', () => {
    expect(rafiqCardState([score('2026-11-06')], [], cfg, TODAY)).toEqual({ state: 'stale', lastDay: '2026-11-06' });
    expect(rafiqCardState([score('2026-11-07')], [], cfg, TODAY)).toEqual({ state: 'usual' });
  });

  it('never reads Trend Watch: both cards use Rafiq\'s card state, not trend tables', () => {
    for (const f of ['native/src/components/trends/TrendsCard.tsx']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, f).toContain('useRafiqCard');
      expect(src, f).not.toMatch(/useTrendOverview|trend_baselines|trend_findings/);
    }
  });
});
