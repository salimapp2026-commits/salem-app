// The three white stat cards (Figma "Metrics Row Scroll": HEART RATE / PRESSURE /
// ACTIVITY), shared by the elder and caregiver homes. Real readings only
// (lib/elderHome.ts elderStats): pressure is hidden without a real reading, no
// "Normal" judgement, no step goal.
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ActivityIcon, CircleXIcon, HeartPulseIcon } from '@/components/icons';
import { type BandBadge, barHeights, type ElderStats } from '@/lib/elderHome';
import { formatDate, formatNumber, formatTime, t, tf } from '@/lib/i18n';
import { colors, radius, statType, textStyle } from '@/theme/tokens';

/** "16:03" today, the date otherwise — one short line. */
export function shortWhen(iso: string): string {
  return new Date(iso).toDateString() === new Date().toDateString() ? formatTime(iso) : formatDate(iso);
}

/** The band badge's words (lib/elderHome.ts bandBadge). */
export function bandLine(b: BandBadge): string {
  if (b.kind === 'connected') return t('eh.bandOn');
  if (b.kind === 'hc_sync') return tf('eh.lastSync', { time: shortWhen(b.at) });
  return t('eh.bandOff');
}

/** side: the row's padding at each edge (elder frame 13, caregiver frame 20). */
export function VitalCards({ stats: s, side }: { stats: ElderStats | null; side: number }) {
  return (
    <View style={[styles.row, { paddingStart: side, paddingEnd: side }]}>
      <StatCard side={side} label={t('eh.hr')} icon={<HeartPulseIcon />}>
        {s?.heartRate ? (
          <>
            <Text style={styles.value}>{s.heartRate.bpm} bpm</Text>
            <View style={styles.bars}>
              {barHeights(s.heartRate.bars).map((h, i) => <View key={i} style={[styles.bar, { height: h }]} />)}
            </View>
          </>
        ) : <Text style={styles.hint}>{t('eh.noReading')}</Text>}
      </StatCard>
      {s?.pressure ? (
        <StatCard side={side} label={t('eh.bp')} icon={<ActivityIcon />}>
          <Text style={styles.value}>{s.pressure.systolic}/{s.pressure.diastolic}</Text>
          <Text style={styles.hint} numberOfLines={1}>{tf('eh.measured', { time: shortWhen(s.pressure.at) })}</Text>
        </StatCard>
      ) : null}
      <StatCard side={side} label={t('eh.activity')} icon={<CircleXIcon />}>
        {s?.steps !== null && s?.steps !== undefined ? (
          <>
            <Text style={styles.value}>{formatNumber(s.steps)}</Text>
            <Text style={styles.hint}>{t('eh.stepsToday')}</Text>
          </>
        ) : <Text style={styles.hint}>{t('eh.noReading')}</Text>}
      </StatCard>
    </View>
  );
}

function StatCard({ label, icon, side, children }: { label: string; icon: ReactNode; side: number; children: ReactNode }) {
  // A third of the row each, as in the frames; a hidden pressure card leaves the others that wide.
  const { width } = useWindowDimensions();
  const w = Math.max(100, (Math.min(width, 480) - 2 * side - 24) / 3);
  return (
    <View style={[styles.card, { width: w }]}>
      <View style={styles.titleRow}>
        <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
        {icon}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  card: { minHeight: 97, backgroundColor: colors.surface, borderRadius: radius.stat, padding: 14, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...textStyle(statType.label), color: colors.textMuted, flexShrink: 1 },
  value: { ...textStyle(statType.value), color: colors.textPrimary },
  hint: { ...textStyle(statType.hint), color: colors.textMuted },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 28 },
  bar: { width: 3, borderRadius: 1.5, backgroundColor: colors.accent },
});
