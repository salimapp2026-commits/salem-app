// Rafiq insights — what Rafiq sees for one elder (docs/RAFIQ_ML_PLAN.md §4.8).
//
//   • status today: Rafiq's level and its reasons, in plain words
//   • one card per reading (resting heart rate at night, oxygen at night, skin
//     temperature at night, activity): status, and Day / Week / Month against
//     the person's own usual range (shaded)
//   • alert history with reasons; caregivers and doctors can mark one as seen
//   • the not-a-medical-device note, always
//
// Opened from the Rafiq tab: family passes ?elderId=…, an elder sees their own
// (a softer view: no alert list), a doctor comes from a patient file.
// Brand colours: indigo #261CC1 header, blue #3A9AFF accents, #F5F5F5 sheet.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from '@/navigation/router';
import { Feather } from '@react-native-vector-icons/feather';
import { useQuery } from '@tanstack/react-query';
import { FilterChips, FieldScreen, SubHeader } from '@/components/dashboard';
import { RangeBar } from '@/components/rafiq/RangeBar';
import { TrendChart } from '@/components/trends/TrendChart';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/i18n';
import {
  metricLevel, metricPoints, RAFIQ_METRICS, type RafiqAlert, type RafiqBaseline, type RafiqScore, useAcknowledgeRafiqAlert,
  useRafiqAlerts, useRafiqBaselines, useRafiqScores, usualRange,
} from '@/lib/rafiq';
import { levelLabel, NOT_A_DEVICE, NOTE } from '@/supabase/functions/_shared/rafiq/text';
import type { Level } from '@/supabase/functions/_shared/rafiq/core';
import { bucketForRole, useAuthStore } from '@/stores/authStore';
import { colors, radius, space, type } from '@/theme/tokens';

type Period = 'day' | 'week' | 'month';
const SHEET = colors.surfaceMuted; // #F5F5F5

function levelColour(l: Level) {
  if (l === 'urgent' || l === 'alert') return colors.alertCritical;
  if (l === 'watch') return colors.alertWarning;
  return colors.accent;
}

export default function RafiqScreen() {
  const params = useLocalSearchParams<{ elderId?: string }>();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  const bucket = useAuthStore((s) => bucketForRole(s.role));
  const elderId = params.elderId ?? (bucket === 'elder' ? userId : undefined);
  const isElder = bucket === 'elder' && elderId === userId;

  const profile = useQuery({
    queryKey: ['rafiq_elder', elderId],
    enabled: !!elderId,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('display_name').eq('id', elderId!).maybeSingle();
      return ((data?.display_name as string | undefined) ?? '').trim().split(/\s+/)[0] || 'them';
    },
  });
  const scores = useRafiqScores(elderId);
  const baselines = useRafiqBaselines(elderId);
  const alerts = useRafiqAlerts(elderId, !isElder);
  const ack = useAcknowledgeRafiqAlert(elderId);

  return (
    <RafiqContent
      elderId={elderId}
      name={profile.data ?? ''}
      isElder={isElder}
      loading={scores.isLoading || baselines.isLoading}
      scores={scores.data ?? []}
      baselines={baselines.data ?? {}}
      alerts={alerts.data ?? []}
      onAck={(id) => ack.mutate(id)}
      ackBusy={ack.isPending}
      onOpenTrends={() => elderId && router.push({ pathname: '/trends/[elderId]', params: { elderId } })}
    />
  );
}

/** The screen itself, from data (also rendered by /dev/rafiq-preview with sample data). */
export function RafiqContent({
  elderId, name, isElder, loading, scores, baselines, alerts, onAck, ackBusy, onOpenTrends,
}: {
  elderId: string | undefined;
  name: string;
  isElder: boolean;
  loading: boolean;
  scores: RafiqScore[];
  baselines: Record<string, RafiqBaseline>;
  alerts: RafiqAlert[];
  onAck: (id: string) => void;
  ackBusy: boolean;
  onOpenTrends: () => void;
}) {
  const [period, setPeriod] = useState<Period>('week');
  const latest: RafiqScore | undefined = scores[0];

  return (
    <FieldScreen>
      <SubHeader title="Rafiq" />
      {elderId ? (
        <FilterChips<Period>
          items={[
            { key: 'day', label: 'Day', icon: 'sun' },
            { key: 'week', label: 'Week', icon: 'calendar' },
            { key: 'month', label: 'Month', icon: 'bar-chart-2' },
          ]}
          active={period}
          onSelect={setPeriod}
        />
      ) : null}

      <ScrollView style={styles.sheet} contentContainerStyle={styles.body}>
        {!elderId ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rafiq is per person</Text>
            <Text style={styles.text}>Open a patient file and choose Rafiq to see their readings against their own normal.</Text>
          </View>
        ) : loading ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : !latest ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No Rafiq results yet</Text>
            <Text style={styles.text}>
              Rafiq looks at the Salem Band data every morning. Once the band has been worn for about two weeks,
              it knows {name || 'this person'}&apos;s normal and starts comparing.
            </Text>
          </View>
        ) : (
          <>
            <StatusCard score={latest} name={name} isElder={isElder} />

            {RAFIQ_METRICS.map((m) => {
              const b = baselines[m.key];
              const range = usualRange(b, m.relative);
              const points = metricPoints(scores, m.key, b?.median ?? null, m.relative);
              const today = points.length ? points[points.length - 1] : undefined;
              const level = metricLevel(latest, m.reason);
              const value = today?.enough ? today.value : null;
              // No reason yet (Rafiq waits for a second day) but already outside their range: say so plainly.
              const outside = level === 'normal' && value != null && range.low != null && range.high != null
                && (value < range.low || value > range.high);
              const pill = b?.learning || latest.learning ? 'Learning'
                : outside ? 'Outside their usual range' : levelLabel(level, 'en');
              const pillColour = outside ? colors.textSecondary : levelColour(level);
              return (
                <View key={m.key} style={styles.card}>
                  <View style={styles.metricHead}>
                    <View style={styles.metricIcon}>
                      <Feather name={m.icon} size={16} color={colors.primary} />
                    </View>
                    <Text style={styles.cardTitle}>{m.label}</Text>
                    <View style={[styles.pill, { borderColor: pillColour }]}>
                      <Text style={[styles.pillText, { color: pillColour }]}>{pill}</Text>
                    </View>
                  </View>
                  <Text style={styles.value}>
                    {value == null ? '—' : `${value.toFixed(m.decimals)}${m.unit.startsWith('%') ? '' : ' '}${m.unit}`}
                  </Text>
                  {period === 'day' ? (
                    <RangeBar value={value} low={range.low} high={range.high} unit={m.unit} decimals={m.decimals}
                      accessibilityLabel={`${m.label} compared with the usual range`} />
                  ) : (
                    <TrendChart points={points} low={range.low} high={range.high} median={range.median}
                      days={period === 'week' ? 7 : 30}
                      accessibilityLabel={`${m.label}, last ${period === 'week' ? 7 : 30} days, with the usual range shaded`} />
                  )}
                </View>
              );
            })}

            {!isElder ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Alert history</Text>
                {alerts.length ? (
                  alerts.map((a) => <AlertRow key={a.id} a={a} onAck={() => onAck(a.id)} busy={ackBusy} />)
                ) : (
                  <Text style={styles.muted}>No Rafiq alerts so far.</Text>
                )}
              </View>
            ) : null}

            {!isElder ? (
              <Pressable
                style={({ pressed }) => [styles.card, styles.linkRow, pressed && { opacity: 0.85 }]}
                onPress={onOpenTrends}
                accessibilityRole="button"
              >
                <Feather name="trending-up" size={18} color={colors.accent} />
                <Text style={[styles.text, { flex: 1 }]}>Weekly summary and long-term trends</Text>
                <Feather name="chevron-right" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </>
        )}
        <Text style={styles.note}>{NOT_A_DEVICE.en}</Text>
      </ScrollView>
    </FieldScreen>
  );
}

function StatusCard({ score, name, isElder }: { score: RafiqScore; name: string; isElder: boolean }) {
  const colour = levelColour(score.level);
  let headline: string;
  if (score.learning) headline = isElder ? 'Rafiq is still learning your normal' : `Rafiq is still learning ${name}'s normal`;
  else if (score.level === 'normal') headline = isElder ? 'Your readings look usual for you' : `${name}'s readings look usual for them`;
  else headline = levelLabel(score.level, 'en');
  return (
    <View style={[styles.card, styles.status, { borderLeftColor: colour }]}>
      <Text style={styles.statusLabel}>
        {formatDate(new Date(`${score.scored_for}T12:00:00Z`))} · the day and the night after it
      </Text>
      <Text style={[styles.statusHeadline, { color: score.level === 'normal' ? colors.primary : colour }]}>{headline}</Text>
      {score.learning ? (
        <Text style={styles.text}>It needs about two weeks of band data before it says anything.</Text>
      ) : isElder && score.level !== 'normal' ? (
        <Text style={styles.text}>
          Some readings are different from your usual. Your family and doctor can see them. Contact your doctor if you
          feel unwell.
        </Text>
      ) : (
        <>
          {score.reasons.map((r) => (
            <Text key={r.code} style={styles.reason}>
              • {r.en}
            </Text>
          ))}
          {score.reasons.length ? <Text style={styles.text}>{NOTE.en(name)}</Text> : null}
        </>
      )}
    </View>
  );
}

function AlertRow({ a, onAck, busy }: { a: RafiqAlert; onAck: () => void; busy: boolean }) {
  const colour = levelColour(a.level);
  return (
    <View style={styles.alertRow}>
      <View style={styles.alertHead}>
        <Text style={[styles.alertLevel, { color: colour }]}>{levelLabel(a.level, 'en')}</Text>
        <Text style={styles.muted}>{formatDate(new Date(a.opened_at))}</Text>
      </View>
      <Text style={styles.text}>{a.reason_en}</Text>
      {a.status === 'open' ? (
        <Pressable onPress={onAck} disabled={busy} style={({ pressed }) => [styles.ack, pressed && { opacity: 0.8 }]}
          accessibilityRole="button">
          <Text style={styles.ackText}>Mark as seen</Text>
        </Pressable>
      ) : (
        <Text style={styles.muted}>{a.status === 'resolved' ? 'Back to usual' : 'Seen'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: SHEET, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  body: { padding: space.m, paddingBottom: space.xxl, gap: space.m },
  card: { backgroundColor: colors.surface, borderRadius: radius.m, padding: space.m, gap: space.xs },
  cardTitle: { ...type.cardTitle, color: colors.textPrimary, textAlign: 'left', flex: 1 },
  text: { ...type.body, color: colors.textSecondary, textAlign: 'left' },
  muted: { ...type.caption, color: colors.textMuted, textAlign: 'left' },
  note: { ...type.caption, color: colors.textMuted, textAlign: 'left', marginTop: space.s },
  status: { borderLeftWidth: 5 },
  statusLabel: { ...type.caption, color: colors.textMuted, textAlign: 'left' },
  statusHeadline: { ...type.title, textAlign: 'left' },
  reason: { ...type.body, color: colors.textPrimary, textAlign: 'left' },
  metricHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  metricIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2 },
  pillText: { ...type.micro },
  value: { ...type.statValue, color: colors.textPrimary, textAlign: 'left' },
  alertRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.surfaceMuted, paddingTop: space.s, gap: 4 },
  alertHead: { flexDirection: 'row', justifyContent: 'space-between' },
  alertLevel: { ...type.cardTitle },
  ack: { alignSelf: 'flex-start', borderRadius: radius.pill, backgroundColor: colors.accent, paddingHorizontal: space.m, paddingVertical: 6 },
  ackText: { ...type.cardBody, color: colors.textInverse },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
});
