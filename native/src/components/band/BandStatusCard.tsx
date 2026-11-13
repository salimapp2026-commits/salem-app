// Salem Band status card — caregiver dashboard, doctor's patient file and the
// elder's own home. Same white-card look as the Trends card.
//
//   connected?  "Synced 3 min ago" (green) / "Synced 2 h ago" / "No data · last sync 14 h ago" (amber)
//   battery     "Battery 64%" or "Charging"
//   wrist       "On the wrist" / "Off the wrist since 10:40"
//   worn today  "Worn today: 7 h 20 min" (from the 10-minute step blocks)
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import { agoLabel, syncState, useBandStatus } from '@/lib/band';
import { formatTime, t, tf } from '@/lib/i18n';
import { colors, space, type } from '@/theme/tokens';

export function BandStatusCard({
  elderId,
  elderName,
  self = false,
  hideWhenUnpaired = false,
}: {
  elderId: string;
  elderName?: string;
  /** The elder looking at their own band (simpler wording). */
  self?: boolean;
  /** Render nothing unless a band is paired (elder home). */
  hideWhenUnpaired?: boolean;
}) {
  const status = useBandStatus(elderId);
  const s = status.data;
  const name = (elderName ?? '').trim().split(/\s+/)[0] || elderName || '';

  if (hideWhenUnpaired && (!s || !s.paired)) return null;

  if (!s) {
    return (
      <View style={styles.card}>
        <Head title={t('band.title')} line={status.isError ? '—' : t('common.loading')} tone="muted" />
      </View>
    );
  }

  if (!s.paired) {
    return (
      <View style={styles.card}>
        <Head
          title={t('band.title')}
          line={self ? t('band.notPaired.self') : tf('band.notPaired.family', { name })}
          tone="muted"
        />
      </View>
    );
  }

  const sync = syncState(s);
  const syncLine =
    sync === 'never' ? t('band.neverSynced')
    : sync === 'quiet' ? tf('band.noDataFor', { ago: agoLabel(s.last_upload_at!) })
    : tf('band.synced', { ago: agoLabel(s.last_upload_at!) });
  const tone = sync === 'fresh' ? 'good' : sync === 'stale' ? 'muted' : 'attention';

  const offWrist = s.worn === false;
  const hours = Math.floor(s.worn_minutes_today / 60);
  const mins = s.worn_minutes_today % 60;
  const lowBattery = s.battery_pct != null && s.battery_pct <= 20 && !s.is_charging;

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${t('band.title')}: ${syncLine}`}
    >
      <Head title={t('band.title')} line={syncLine} tone={tone} badge={tf('band.serial', { last4: s.serial_last4 })} />
      <View style={styles.facts}>
        <Fact
          icon={s.is_charging ? 'battery-charging' : 'battery'}
          text={s.is_charging ? t('band.charging') : s.battery_pct != null ? tf('band.battery', { n: s.battery_pct }) : '—'}
          warn={lowBattery}
        />
        <Fact
          icon="watch"
          text={offWrist && s.worn_changed_at
            ? tf('band.offWristSince', { time: formatTime(s.worn_changed_at) })
            : s.worn === null ? '—' : t('band.onWrist')}
          warn={offWrist}
        />
        <Fact icon="clock" text={tf('band.wornToday', { h: hours, m: mins })} />
      </View>
    </View>
  );
}

function Head({
  title,
  line,
  tone,
  badge,
}: {
  title: string;
  line: string;
  tone: 'good' | 'muted' | 'attention';
  badge?: string;
}) {
  return (
    <View style={styles.head}>
      <View style={[styles.icon, tone === 'attention' && styles.iconAttention]}>
        <Feather name="watch" size={20} color={tone === 'attention' ? colors.alertWarning : colors.accent} />
      </View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {badge ? <Text style={styles.badge}>{badge}</Text> : null}
        </View>
        <View style={styles.lineRow}>
          {tone === 'good' ? <View style={styles.dot} /> : null}
          <Text
            style={[styles.line, tone === 'good' && styles.lineGood, tone === 'attention' && styles.lineAttention]}
          >
            {line}
          </Text>
        </View>
      </View>
    </View>
  );
}

function Fact({ icon, text, warn = false }: { icon: ComponentProps<typeof Feather>['name']; text: string; warn?: boolean }) {
  return (
    <View style={styles.fact}>
      <Feather name={icon} size={14} color={warn ? colors.alertWarning : colors.textMuted} />
      <Text style={[styles.factText, warn && styles.lineAttention]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: space.m, gap: space.s },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconAttention: { backgroundColor: '#fff4dc' },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  title: { ...type.cardTitle, color: colors.textPrimary, textAlign: 'left' },
  badge: { ...type.micro, color: colors.textMuted },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  line: { ...type.cardBody, color: colors.textSecondary, textAlign: 'left', flexShrink: 1 },
  lineGood: { color: colors.success },
  lineAttention: { color: colors.alertWarning },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.m, rowGap: 6, paddingLeft: 56 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  factText: { ...type.caption, color: colors.textSecondary },
});
