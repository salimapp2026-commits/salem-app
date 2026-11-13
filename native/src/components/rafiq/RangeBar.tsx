// One day's value against the person's usual range: a track with the usual
// zone shaded in brand blue and a dot for the value. Plain Views, so it looks
// the same on web and phones.
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, type } from '@/theme/tokens';

export function RangeBar({
  value,
  low,
  high,
  unit,
  decimals,
  accessibilityLabel,
}: {
  value: number | null;
  low: number | null;
  high: number | null;
  unit: string;
  decimals: number;
  accessibilityLabel: string;
}) {
  if (value == null || low == null || high == null) {
    return <Text style={styles.empty}>Not enough readings yet</Text>;
  }
  const pad = (high - low) * 0.6 || 1;
  const min = Math.min(low - pad, value - pad * 0.2);
  const max = Math.max(high + pad, value + pad * 0.2);
  const pct = (x: number) => `${((x - min) / (max - min)) * 100}%` as const;
  const inside = value >= low && value <= high;
  return (
    <View accessible accessibilityLabel={accessibilityLabel}>
      <View style={styles.track}>
        <View style={[styles.usual, { left: pct(low), width: `${((high - low) / (max - min)) * 100}%` }]} />
        <View style={[styles.dot, { left: pct(value) }, !inside && styles.dotOut]} />
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendText}>
          Usual {low.toFixed(decimals)}–{high.toFixed(decimals)}{unit.startsWith('%') ? '' : ' '}{unit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 14, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, marginTop: 8, justifyContent: 'center' },
  usual: { position: 'absolute', top: 0, bottom: 0, borderRadius: radius.pill, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  dot: { position: 'absolute', width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.surface },
  dotOut: { backgroundColor: colors.alertWarning },
  legend: { marginTop: 6 },
  legendText: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  empty: { ...type.caption, color: colors.textMuted, marginTop: 8, textAlign: 'left' },
});
