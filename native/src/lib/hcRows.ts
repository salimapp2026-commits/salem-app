// Health Connect records → the rows hc_ingest() stores (step31a), in the shape
// Rafiq already reads from a Salem Band (supabase/functions/_shared/rafiq/core.ts).
// Pure — no imports — so it is tested without a phone (tests/hcRows.test.ts).
//
// What Rafiq needs, and how a band app's data provides it:
//   heart rate  resting samples (is_resting) with quality ≥ min_quality (60).
//               Resting = during a sleep session, or in a 10-minute block with
//               no steps. Health Connect has no quality, so HC_QUALITY.
//   oxygen      the same rule (Rafiq uses night oxygen while resting).
//   steps       one row per 10-minute block (captured_at = block start), the
//               record's count split by overlap. A block with a heart-rate
//               sample but no steps gets 0: the band was worn and the elder
//               did not walk. That is how Rafiq counts hours worn.
//   not here    skin temperature and movement (most band apps don't write
//               them): those Rafiq signals stay silent for these elders.
//
// Only whole blocks that have ended are sent (a block still running would be
// sent as 0 and look like stillness). Re-sending the same window is safe: the
// database keeps one row per elder, kind and moment, and updates it.

export const BLOCK_SECONDS = 600;
/** Health Connect readings carry no signal quality; this passes Rafiq's min_quality (60). */
export const HC_QUALITY = 80;
/** At most one heart-rate / oxygen sample per minute (some apps write every second). */
const SAMPLE_SECONDS = 60;

export type HcHeartRate = { startTime: string; endTime: string; samples: { time: string; beatsPerMinute: number }[] };
export type HcSteps = { startTime: string; endTime: string; count: number };
export type HcOxygen = { time: string; percentage: { value: number } | number };
export type HcSleep = { startTime: string; endTime: string };

export type HcRow = { k: 'heart_rate' | 'spo2' | 'steps'; t: string; v: number; r: boolean; q: number | null };

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const iso = (s: number) => new Date(s * 1000).toISOString();

export function hcRows(
  input: { heartRate: HcHeartRate[]; steps: HcSteps[]; oxygen: HcOxygen[]; sleep: HcSleep[] },
  nowMs: number,
): HcRow[] {
  const lastBlockEnd = Math.floor(nowMs / 1000 / BLOCK_SECONDS) * BLOCK_SECONDS;   // blocks before this have ended
  const sleeps = input.sleep.map((s) => [sec(s.startTime), sec(s.endTime)] as const);
  const asleep = (t: number) => sleeps.some(([a, b]) => t >= a && t < b);

  // Steps per 10-minute block, split by overlap.
  const steps = new Map<number, number>();
  for (const r of input.steps) {
    const a = sec(r.startTime), b = sec(r.endTime);
    if (!(r.count >= 0) || !(b >= a)) continue;
    if (b === a) {
      const blk = Math.floor(a / BLOCK_SECONDS);
      steps.set(blk, (steps.get(blk) ?? 0) + r.count);
      continue;
    }
    for (let blk = Math.floor(a / BLOCK_SECONDS); blk * BLOCK_SECONDS < b; blk++) {
      const lo = Math.max(a, blk * BLOCK_SECONDS), hi = Math.min(b, (blk + 1) * BLOCK_SECONDS);
      if (hi > lo) steps.set(blk, (steps.get(blk) ?? 0) + (r.count * (hi - lo)) / (b - a));
    }
  }

  // Samples, one per minute, only from ended blocks.
  const samples = (list: { t: number; v: number }[]) => {
    const byMinute = new Map<number, { t: number; v: number }>();
    for (const s of list) {
      if (!Number.isFinite(s.t) || !Number.isFinite(s.v) || s.t >= lastBlockEnd) continue;
      const m = Math.floor(s.t / SAMPLE_SECONDS);
      if (!byMinute.has(m)) byMinute.set(m, { t: m * SAMPLE_SECONDS, v: s.v });
    }
    return [...byMinute.values()].sort((x, y) => x.t - y.t);
  };
  const hr = samples(input.heartRate.flatMap((r) => r.samples.map((s) => ({ t: sec(s.time), v: s.beatsPerMinute }))));
  const ox = samples(input.oxygen.map((o) => ({
    t: sec(o.time), v: typeof o.percentage === 'number' ? o.percentage : o.percentage.value,
  })));

  const resting = (t: number) => asleep(t) || (steps.get(Math.floor(t / BLOCK_SECONDS)) ?? 0) === 0;
  const out: HcRow[] = [];
  for (const s of hr) out.push({ k: 'heart_rate', t: iso(s.t), v: Math.round(s.v), r: resting(s.t), q: HC_QUALITY });
  for (const s of ox) out.push({ k: 'spo2', t: iso(s.t), v: Math.round(s.v * 10) / 10, r: resting(s.t), q: HC_QUALITY });

  // Worn blocks: any steps, or a heart-rate sample.
  const worn = new Set<number>([...steps.keys(), ...hr.map((s) => Math.floor(s.t / BLOCK_SECONDS))]);
  for (const blk of [...worn].sort((x, y) => x - y)) {
    if ((blk + 1) * BLOCK_SECONDS > lastBlockEnd) continue;
    out.push({ k: 'steps', t: iso(blk * BLOCK_SECONDS), v: Math.round(steps.get(blk) ?? 0), r: false, q: null });
  }
  return out;
}

/** Calls of at most `size` rows (hc_ingest takes 5000). */
export function chunks<T>(rows: T[], size = 2000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** What to read on this sync: the last 48 h again (band apps fill hours in late), back to
 *  at most 30 days on the first sync. */
export function syncWindow(lastSyncMs: number | null, nowMs: number): { fromMs: number; toMs: number } {
  const DAY = 86_400_000;
  const from = lastSyncMs === null ? nowMs - 30 * DAY : Math.max(nowMs - 30 * DAY, lastSyncMs - 2 * DAY);
  return { fromMs: from, toMs: nowMs };
}
