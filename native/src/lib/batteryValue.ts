// Kept apart from battery.ts so tests can load it without react-native.

/** A whole percent 0–100, or null for anything else. */
export function toBatteryPct(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const pct = Math.round(raw);
  return pct >= 0 && pct <= 100 ? pct : null;
}
