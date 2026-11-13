// rafiq_config now reaches the scorer (run.ts withConfig): what changes when the
// beta's learning period is 7 days instead of 14, measured on the three synthetic
// elders (tests/fixtures/rafiq, the same as the parity test).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Rows } from '../supabase/functions/_shared/rafiq/core.ts';
import type { RafiqModel } from '../supabase/functions/_shared/rafiq/model.ts';
import { CONFIG_DECIDE, CONFIG_PARAMS, type RafiqStore, analyse, withConfig } from '../supabase/functions/_shared/rafiq/run.ts';

const ROOT = join(__dirname, '..');
const model = JSON.parse(readFileSync(join(ROOT, 'supabase/functions/_shared/rafiq/model.json'), 'utf8')) as RafiqModel;

// rafiq_config as seeded by step30c (and live on salem-prod, read 2026-10-31).
const SEED: Record<string, number> = {
  alert_min_days: 3, alert_z: 3, baseline_days: 28, daily_run_hour_cairo: 7, intraday_retention_days: 90,
  learning_min_days: 14, max_notifications_per_day: 2, min_quality: 60, min_readings_segment: 3,
  min_wear_hours_day: 8, night_end_hour: 7, night_start_hour: 22, notify_cooldown_hours: 72, recent_days: 7,
  resolve_days: 3, scoring_daily_enabled: 1, scoring_hourly_enabled: 0, urgent_inactive_awake_hours: 6,
  urgent_night_hr_rise_bpm: 15, urgent_night_spo2_median: 90, use_model: 1, watch_min_days: 2, watch_z: 2,
};
const BETA = { ...SEED, learning_min_days: 7, recent_days: 2 };

function fixture(name: string) {
  const f = JSON.parse(gunzipSync(readFileSync(join(ROOT, `tests/fixtures/rafiq/parity-${name}.json.gz`))).toString('utf8'));
  const rows: Rows = { ...f.rows, resting: (f.rows.resting as number[]).map((x) => x === 1) };
  return { rows, events: f.events, tz: f.tz as string, days: (f.expected as { day: number }[]).map((e) => e.day),
    labels: f.labels as { type: string; real: boolean; start: number; end: number }[] };
}
const memStore = (fx: ReturnType<typeof fixture>) => ({
  bandRows: async () => fx.rows,
  bandEvents: async () => fx.events,
}) as unknown as RafiqStore;

async function run(name: string, cfg: Record<string, number>) {
  const fx = fixture(name);
  const first = fx.days[0], last = fx.days.at(-1)!;
  const { decisions } = await analyse(memStore(fx), withConfig(model, cfg), { elder_id: 'e', display_name: 'E', timezone: fx.tz }, last);
  const d = [...decisions].filter(([day]) => day >= first).sort((a, b) => a[0] - b[0]);
  const speaksFrom = d.find(([, x]) => !x.learning)?.[0];
  const spoken = d.filter(([, x]) => x.level !== 'normal').map(([day, x]) => [day - first, x.level] as const);
  return { fx, first, speaksFrom: speaksFrom === undefined ? null : speaksFrom - first, spoken };
}

describe('rafiq_config reaches the scorer', () => {
  it('as seeded, it changes nothing: the live config equals the model\'s own values', () => {
    const m = withConfig(model, SEED);
    expect(m.params).toEqual(model.params);
    expect(m.decide).toEqual(model.decide);
    expect(m.use_model).toBe(true);
  });

  it('only whitelisted keys, only inside their range', () => {
    const m = withConfig(model, { ...SEED, learning_min_days: 0, recent_days: 99, min_quality: 10, baseline_days: 3, watch_z: 9 });
    expect(m.params).toEqual(model.params);
    expect(m.decide).toEqual(model.decide);
    expect(Object.keys(CONFIG_PARAMS)).toEqual(['learning_min_days', 'recent_days', 'min_wear_hours_day']);
    expect(Object.keys(CONFIG_DECIDE)).not.toContain('min_quality');
    expect(withConfig(model, { ...SEED, use_model: 0 }).use_model).toBe(false);
  });

  for (const name of ['nov-2026', 'dst-apr-2027', 'fall-inactivity']) {
    it(`${name}: 7-day learning speaks a week earlier and still catches every real event`, async () => {
      const now = await run(name, SEED);
      const beta = await run(name, BETA);
      const betaNoModel = await run(name, { ...BETA, use_model: 0 });
      // Measured, printed for the founder's report.
      console.log(name, JSON.stringify({
        speaks_from_day: { learning14: now.speaksFrom, learning7: beta.speaksFrom },
        days_not_normal: { learning14: now.spoken.length, learning7: beta.spoken.length, learning7_no_model: betaNoModel.spoken.length },
        first_4_weeks: {
          learning14: now.spoken.filter(([d]) => d < 28).length,
          learning7: beta.spoken.filter(([d]) => d < 28).length,
          learning7_no_model: betaNoModel.spoken.filter(([d]) => d < 28).length,
        },
      }));
      expect(beta.speaksFrom!).toBeLessThan(now.speaksFrom!);
      expect(beta.speaksFrom!).toBeLessThanOrEqual(10);
      // Every labelled real event: a non-normal day within its window (or the day after), in both.
      for (const l of now.fx.labels.filter((x) => x.real)) {
        for (const r of [now, beta]) {
          const hit = r.spoken.some(([d]) => d >= l.start && d <= l.end + 1);
          expect(hit, `${name} ${l.type} ${r === now ? '14' : '7'}`).toBe(true);
        }
      }
    }, 60_000);
  }
});
