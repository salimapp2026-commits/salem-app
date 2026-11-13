// The Trend Watch body shared by the caregiver detail screen and the doctor's
// "Trends" tab: learning state, this week's summary, one card per metric
// (28-day chart with the usual range shaded, the explanation, the allowed next
// steps) and — for doctors — the findings list with "Mark as expected".
//
// Styled with the Figma field components (white cards on the indigo field).
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { FieldCard, FieldEmpty } from '@/components/dashboard';
import { Button } from '@/components/Button';
import { TrendChart } from '@/components/trends/TrendChart';
import {
  type DailyPoint,
  type Metric,
  type TrendBaseline,
  type TrendFinding,
  explanationFor,
  markTrendExpected,
  trendLang,
  useTrendOverview,
  useTrendSeries,
} from '@/lib/trends';
import { METRIC_LABEL, METRIC_UNIT, NEXT_STEP_TEXT, type NextStep } from '@/supabase/functions/_shared/trendText';
import { formatDate, t, tf } from '@/lib/i18n';
import { colors, radius, space, type } from '@/theme/tokens';

export function TrendsPanel({
  elderId,
  elderName,
  doctor = false,
}: {
  elderId: string;
  elderName: string;
  doctor?: boolean;
}) {
  const overview = useTrendOverview(elderId);
  const series = useTrendSeries(elderId);
  const lang = trendLang();

  if (overview.isLoading || series.isLoading) return <FieldEmpty text={t('common.loading')} />;
  if (overview.error || !overview.data) return <FieldEmpty text={String((overview.error as Error)?.message ?? '')} />;

  const { baselines, findings, open, weekly, state, learningDay } = overview.data;
  const name = elderName.trim().split(/\s+/)[0] || elderName;

  // Metrics with an open finding first, then the rest in the fixed order.
  const order = (m: Metric) => (open.some((f) => f.metric === m) ? 0 : 1);
  const metrics = [...baselines].sort((a, b) => order(a.metric) - order(b.metric));

  return (
    <View style={styles.wrap}>
      {state === 'no_data' ? (
        <FieldCard>
          <Text style={styles.body}>{t('trends.noData')}</Text>
        </FieldCard>
      ) : null}

      {state === 'learning' ? (
        <FieldCard style={styles.learning}>
          <Text style={styles.learningText}>{tf('trends.learning', { name, x: learningDay })}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${(Math.min(learningDay, 14) / 14) * 100}%` }]} />
          </View>
        </FieldCard>
      ) : null}

      {weekly ? (
        <FieldCard>
          <Text style={styles.cardTitle}>
            {t('trends.weekly')} · {formatDate(weekly.week_start)}
          </Text>
          <Text style={styles.body}>{lang === 'ar' ? weekly.summary_ar : weekly.summary_en}</Text>
        </FieldCard>
      ) : null}

      {metrics.map((b) => (
        <TrendMetricCard
          key={b.metric}
          baseline={b}
          points={series.data?.get(b.metric) ?? []}
          finding={open.find((f) => f.metric === b.metric) ?? null}
          doctor={doctor}
          elderId={elderId}
        />
      ))}

      {doctor ? <FindingsList findings={findings} elderId={elderId} /> : null}
    </View>
  );
}

export function TrendMetricCard({
  baseline,
  points,
  finding,
  doctor,
  elderId,
}: {
  baseline: TrendBaseline;
  points: DailyPoint[];
  finding: TrendFinding | null;
  doctor: boolean;
  elderId: string;
}) {
  const lang = trendLang();
  const label = METRIC_LABEL[baseline.metric][lang];
  const unit = METRIC_UNIT[baseline.metric][lang];
  const latest = [...points].reverse().find((p) => p.enough);
  const chip = baseline.learning
    ? { text: t('trends.learningShort'), bg: colors.surfaceMuted, fg: colors.textSecondary }
    : finding
      ? { text: t('trends.changed'), bg: '#fff4dc', fg: colors.alertWarning }
      : { text: t('trends.usual'), bg: colors.successSoft, fg: colors.success };

  return (
    <FieldCard style={styles.metricCard}>
      <View style={styles.headRow}>
        <Text style={styles.cardTitle}>{label}</Text>
        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{chip.text}</Text>
        </View>
      </View>

      <TrendChart
        points={points}
        low={baseline.low}
        high={baseline.high}
        median={baseline.median}
        accessibilityLabel={`${label}, ${t('trends.last28')}`}
      />

      <View style={styles.legendRow}>
        <View style={styles.legendSwatch} />
        <Text style={styles.legend}>
          {t('trends.normalRange')}
          {baseline.low != null && baseline.high != null
            ? ` ${fmt(baseline.low, baseline.metric)}–${fmt(baseline.high, baseline.metric)} ${unit}`
            : ''}
        </Text>
        {latest ? <Text style={styles.latest}>{`${fmt(latest.value, baseline.metric)} ${unit}`}</Text> : null}
      </View>

      {finding ? (
        <>
          <Text style={styles.body}>{explanationFor(finding)}</Text>
          {finding.next_steps.length ? (
            <View style={styles.steps}>
              <Text style={styles.stepsTitle}>{t('trends.nextSteps')}</Text>
              {finding.next_steps.map((s) => (
                <Text key={s} style={styles.step}>
                  {'•  '}
                  {NEXT_STEP_TEXT[s as NextStep]?.[lang] ?? s}
                </Text>
              ))}
            </View>
          ) : null}
          {doctor ? <MarkExpectedButton finding={finding} elderId={elderId} /> : null}
        </>
      ) : null}
    </FieldCard>
  );
}

function FindingsList({ findings, elderId }: { findings: TrendFinding[]; elderId: string }) {
  const lang = trendLang();
  return (
    <FieldCard>
      <Text style={styles.cardTitle}>{t('trends.findings')}</Text>
      {findings.length === 0 ? <Text style={styles.muted}>{t('trends.noFindings')}</Text> : null}
      {findings.map((f) => (
        <View key={f.id} style={styles.findingRow}>
          <View style={styles.findingText}>
            <Text style={styles.findingTitle}>{METRIC_LABEL[f.metric][lang]}</Text>
            <Text style={styles.muted}>
              {formatDate(f.opened_for)} · {t(`trends.severity.${f.severity}`)} · {t(`trends.status.${f.status}`)}
              {f.expected_reason ? ` · ${f.expected_reason}` : ''}
            </Text>
          </View>
          {f.status === 'open' ? <MarkExpectedButton finding={f} elderId={elderId} compact /> : null}
        </View>
      ))}
    </FieldCard>
  );
}

function MarkExpectedButton({
  finding,
  elderId,
  compact = false,
}: {
  finding: TrendFinding;
  elderId: string;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) {
      setError(t('trends.markExpected.reasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await markTrendExpected(finding.id, reason.trim());
      await qc.invalidateQueries({ queryKey: ['trend-overview', elderId] });
      setOpen(false);
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {compact ? (
        <Pressable onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button">
          <Text style={styles.link}>{t('trends.markExpected')}</Text>
        </Pressable>
      ) : (
        <Button label={t('trends.markExpected')} onPress={() => setOpen(true)} />
      )}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.cardTitle}>{t('trends.markExpected.title')}</Text>
            <Text style={styles.muted}>{t('trends.markExpected.help')}</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder={t('trends.markExpected.reason')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              maxLength={500}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label={t('trends.markExpected.confirm')} onPress={submit} loading={busy} />
            <Button label={t('common.back')} variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

/** Whole numbers, except the two readings where a decimal means something. */
function fmt(n: number, metric: Metric): string {
  return metric === 'skin_temp' || metric === 'spo2'
    ? (Math.round(n * 10) / 10).toString()
    : Math.round(n).toString();
}

const styles = StyleSheet.create({
  wrap: { gap: space.m },
  learning: { gap: space.s },
  learningText: { ...type.cardTitle, color: colors.textPrimary, textAlign: 'left' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  metricCard: { gap: space.s },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { ...type.cardTitle, color: colors.textPrimary, textAlign: 'left' },
  chip: { paddingHorizontal: space.s, paddingVertical: 3, borderRadius: 6 },
  chipText: { fontFamily: type.cardTitle.fontFamily, fontSize: 11 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 12, height: 8, borderRadius: 2, backgroundColor: colors.accentSoft },
  legend: { ...type.micro, color: colors.textSecondary, flex: 1, textAlign: 'left' },
  latest: { ...type.cardTitle, color: colors.primary },
  body: { ...type.cardBody, color: colors.textPrimary, textAlign: 'left', lineHeight: 20 },
  steps: { gap: 4, backgroundColor: colors.cream, borderRadius: radius.m, padding: space.m },
  stepsTitle: { ...type.statLabel, color: colors.textSecondary, textAlign: 'left' },
  step: { ...type.cardBody, color: colors.textPrimary, textAlign: 'left' },
  findingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingVertical: space.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  findingText: { flex: 1, gap: 2 },
  findingTitle: { ...type.cardTitle, color: colors.textPrimary, textAlign: 'left' },
  muted: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  link: { ...type.cardTitle, color: colors.primary },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 8, 40, 0.55)',
    justifyContent: 'center',
    padding: space.l,
  },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, padding: space.l, gap: space.m },
  input: {
    minHeight: 48,
    borderRadius: radius.m,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: space.m,
    ...type.body,
    color: colors.textPrimary,
  },
  error: { ...type.caption, color: colors.alertCritical, textAlign: 'left' },
});
