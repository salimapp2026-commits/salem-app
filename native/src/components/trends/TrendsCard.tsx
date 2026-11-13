// "Trends" card on the caregiver dashboard: what Rafiq sees right now — still
// learning (day x of N), all usual, something to watch, alerts to look at, or
// readings that stopped arriving. Reads Rafiq's tables (lib/rafiqCard.ts);
// tapping opens the Rafiq screen for this elder.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from '@/navigation/router';
import { Feather } from '@react-native-vector-icons/feather';
import { useRafiqCard } from '@/lib/rafiq';
import { formatDate, getLocale, t, tf } from '@/lib/i18n';
import { colors, space, type } from '@/theme/tokens';

/** What Rafiq says about an elder right now, in one line (+ the reason, when there is one).
 *  Shared by this card and the caregiver home's Rafiq report. */
export function rafiqLine(
  data: ReturnType<typeof useRafiqCard>['data'], isError: boolean, name: string, lang: 'ar' | 'en',
): { line: string; tone: 'calm' | 'attention' | 'muted'; preview: string | null } {
  let line = isError ? t('rafiq.card.error') : t('common.loading');
  let tone: 'calm' | 'attention' | 'muted' = 'muted';
  let preview: string | null = null;
  if (data?.state === 'no_data') line = tf('rafiq.card.noData', { name });
  if (data?.state === 'learning') line = tf('rafiq.card.learning', { name, x: data.day, n: data.of });
  if (data?.state === 'stale') line = tf('rafiq.card.stale', { date: formatDate(data.lastDay) });
  if (data?.state === 'usual') {
    line = tf('rafiq.card.usual', { name });
    tone = 'calm';
  }
  if (data?.state === 'watch') {
    line = t('rafiq.card.watch');
    preview = data.preview?.[lang] ?? null;
  }
  if (data?.state === 'attention') {
    line = data.n === 1 ? t('rafiq.card.attentionOne') : tf('rafiq.card.attention', { n: data.n });
    tone = 'attention';
    preview = data.preview?.[lang] ?? null;
  }

  return { line, tone, preview };
}

export function TrendsCard({ elderId, elderName }: { elderId: string; elderName: string }) {
  const router = useRouter();
  const card = useRafiqCard(elderId);
  const lang = getLocale() === 'ar' ? 'ar' : 'en';
  const name = elderName.trim().split(/\s+/)[0] || elderName;
  const { line, tone, preview } = rafiqLine(card.data, card.isError, name, lang);

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/rafiq', params: { elderId } })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
      accessibilityRole="button"
      accessibilityLabel={`${t('trends.card.title')}: ${line}`}
    >
      <View style={styles.head}>
        <View style={[styles.icon, tone === 'attention' && styles.iconAttention]}>
          <Feather
            name="activity"
            size={20}
            color={tone === 'attention' ? colors.alertWarning : colors.accent}
          />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>{t('trends.card.title')}</Text>
          <Text style={[styles.line, tone === 'attention' && styles.lineAttention]}>{line}</Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.textMuted} />
      </View>
      {preview ? (
        <Text style={styles.preview} numberOfLines={2}>
          {preview.split('\n')[0]}
        </Text>
      ) : null}
    </Pressable>
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
  title: { ...type.cardTitle, color: colors.textPrimary, textAlign: 'left' },
  line: { ...type.cardBody, color: colors.textSecondary, textAlign: 'left' },
  lineAttention: { color: colors.alertWarning },
  preview: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
});
