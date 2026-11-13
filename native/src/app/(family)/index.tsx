// Caregiver home — Figma "care giver home" (52:1910).
//
//   wordmark + bell · the elder ("{name}'s Health", band status) · heart rate /
//   pressure / activity · Rafiq report · last known location · adherence today
//
// Real data only, through row-level security: the report is Rafiq's health
// status for the elder (never a word of their conversations with Rafiq); the
// location block shows only to members with the location permission and says
// "Last known location · time" (no "LIVE": there is no live tracking).
// Messages, alerts, the circle and visits are under More
// (docs/DESIGN_DIFFERENCES.md).
import { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@/navigation/router';
import { Avatar } from '@/components/Avatar';
import { TabBar, TABS_FOR, type TabKey } from '@/components/dashboard';
import { VitalCards, bandLine, shortWhen } from '@/components/VitalCards';
import { rafiqLine } from '@/components/trends/TrendsCard';
import { BellIcon, MapPinIcon, MessageCircleIcon } from '@/components/icons';
import { supabase } from '@/lib/supabase';
import { useRafiqCard } from '@/lib/rafiq';
import { useElderStats, useTodayDoses } from '@/lib/elderHomeData';
import { adherenceToday, type ElderStats } from '@/lib/elderHome';
import { getLocale, t, tf } from '@/lib/i18n';
import { colors, radius, textStyle, type TextToken } from '@/theme/tokens';

type Circle = { circle_id: string; elder_id: string; elder_name: string | null; is_elder: boolean };
type Fix = { captured_at: string; zone_name: string | null; inside_zone: boolean | null };

export default function FamilyHome() {
  const router = useRouter();

  // The elder we look after: the first circle where we are not the elder.
  const circles = useQuery<Circle[]>({
    queryKey: ['my_circles'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_circles');
      if (error) throw error;
      return (data ?? []) as Circle[];
    },
  });
  const elder = useMemo(() => (circles.data ?? []).find((c) => !c.is_elder), [circles.data]);
  const elderId = elder?.elder_id;
  const name = (elder?.elder_name ?? '').trim().split(/\s+/)[0] || (elder?.elder_name ?? '');

  const unread = useQuery({
    queryKey: ['unread'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('unread_notification_count');
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });

  const stats = useElderStats(elderId);
  const doses = useTodayDoses(elderId);
  const rafiq = useRafiqCard(elderId);
  const report = rafiqLine(rafiq.data, rafiq.isError, name, getLocale() === 'ar' ? 'ar' : 'en');

  // Location only for members allowed to see it; doctors never are.
  const location = useQuery<Fix | null>({
    queryKey: ['home_location', elderId],
    enabled: !!elderId,
    retry: false,
    queryFn: async () => {
      const { data: may } = await supabase.rpc('can_read_location', { p_elder_id: elderId });
      if (may !== true) return null;
      const { data, error } = await supabase.rpc('elder_live_location', { p_elder_id: elderId });
      if (error) return null;
      return ((Array.isArray(data) ? data[0] : data) as Fix | undefined) ?? null;
    },
  });

  const onTab = (key: TabKey) => {
    if (key === 'rafiq') router.push(elderId ? { pathname: '/rafiq-chat', params: { elderId } } : '/rafiq-chat');
    if (key === 'map') router.push('/location');
    if (key === 'more') router.push('/(family)/more');
  };

  return (
    <CaregiverHomeView
      elderName={elder?.elder_name ?? null}
      hasElder={circles.isFetched ? !!elder : null}
      stats={stats.data ?? null}
      report={report}
      location={location.data ?? null}
      adherence={adherenceToday(doses.data ?? [])}
      unread={unread.data ?? 0}
      onBell={() => router.push('/notifications')}
      onElder={() => router.push('/(family)/circle')}
      onReport={() => elderId && router.push({ pathname: '/rafiq', params: { elderId } })}
      onLocation={() => router.push('/location')}
      onAddMember={() => router.push('/link/add')}
      onTab={onTab}
    />
  );
}

export type CaregiverHomeProps = {
  elderName: string | null;
  hasElder: boolean | null;          // null = still loading
  stats: ElderStats | null;
  report: ReturnType<typeof rafiqLine>;
  location: Fix | null;
  adherence: ReturnType<typeof adherenceToday>;
  unread: number;
  onBell: () => void;
  onElder: () => void;
  onReport: () => void;
  onLocation: () => void;
  onAddMember: () => void;
  onTab: (key: TabKey) => void;
};

/** The screen itself, data in, events out — also rendered by the emulator-only design preview. */
export function CaregiverHomeView(p: CaregiverHomeProps) {
  const band = p.stats?.band;
  const name = (p.elderName ?? '').trim().split(/\s+/)[0] || (p.elderName ?? '');
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.top}>
        <Image source={require('@/assets/brand/wordmark-white.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Salem" />
        <Pressable onPress={p.onBell} style={styles.bell} accessibilityRole="button" accessibilityLabel={t('more.notifications')} hitSlop={8}>
          <BellIcon dot={p.unread > 0} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {p.hasElder === false ? (
          <View style={[styles.block, styles.empty]}>
            <Text style={styles.blockSub}>{t('ch.noElder')}</Text>
            <Pressable onPress={p.onAddMember} style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={styles.emptyButtonText}>{t('more.addMember')}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Pressable onPress={p.onElder} style={styles.profile} accessibilityRole="button">
              <Avatar displayName={p.elderName} size={40} />
              <View style={styles.profileText}>
                <Text style={styles.profileName} numberOfLines={1}>{name ? tf('ch.health', { name }) : t('common.loading')}</Text>
                {band && band.kind !== 'none' ? (
                  <View style={styles.statusRow}>
                    {band.kind === 'connected' ? <View style={styles.statusDot} /> : null}
                    <Text style={[styles.status, band.kind !== 'connected' && styles.statusNeutral]} numberOfLines={1}>
                      {band.kind === 'connected' ? t('ch.connected') : bandLine(band)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>

            <VitalCards stats={p.stats} side={20} />

            <View style={styles.cards}>
              <Pressable onPress={p.onReport} style={({ pressed }) => [styles.report, pressed && styles.pressed]} accessibilityRole="button">
                <View style={styles.reportTitleRow}>
                  <MessageCircleIcon />
                  <Text style={styles.reportTitle}>{t('ch.report')}</Text>
                </View>
                <Text style={[styles.reportBody, p.report.tone === 'attention' && styles.reportAttention]}>{p.report.line}</Text>
                {p.report.preview ? <Text style={styles.reportBody} numberOfLines={2}>{p.report.preview.split('\n')[0]}</Text> : null}
                <Text style={styles.reportHint}>{t('ch.reportOpen')}</Text>
              </Pressable>

              {p.location ? (
                <Pressable onPress={p.onLocation} style={({ pressed }) => [styles.block, styles.locationRow, pressed && styles.pressed]} accessibilityRole="button">
                  <View style={styles.mapTile}><MapPinIcon color={colors.accent} /></View>
                  <View style={styles.flex}>
                    <Text style={styles.blockTitle}>{tf('ch.lastLocation', { time: shortWhen(p.location.captured_at) })}</Text>
                    <Text style={styles.blockSub} numberOfLines={1}>
                      {p.location.inside_zone && p.location.zone_name ? p.location.zone_name : t('ch.locationTap')}
                    </Text>
                  </View>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.adherence}>
              <View style={styles.adherenceHead}>
                <Text style={styles.blockTitle}>{t('ch.adherence')}</Text>
                {p.adherence ? <Text style={styles.pct}>{p.adherence.pct}%</Text> : null}
              </View>
              {p.adherence ? (
                <>
                  <View style={styles.track}><View style={[styles.fill, { width: `${p.adherence.pct}%` }]} /></View>
                  <Text style={styles.caption}>{tf('ch.adherenceCaption', { done: p.adherence.done, total: p.adherence.total })}</Text>
                </>
              ) : <Text style={styles.caption}>{t('eh.noMeds')}</Text>}
            </View>
          </>
        )}
      </ScrollView>
      <TabBar active="home" onSelect={p.onTab} tabs={TABS_FOR.family} />
    </SafeAreaView>
  );
}

// Inter in the frame; the same sizes in Noto Sans Arabic when the app is in Arabic.
const T = {
  name: { size: 18, line: 22, weight: 800 },
  status: { size: 11, line: 13, weight: 600 },
  reportTitle: { size: 14, line: 17, weight: 800 },
  reportBody: { size: 13, line: 18, weight: 500 },
  blockTitle: { size: 14, line: 17, weight: 700 },
  blockSub: { size: 13, line: 16, weight: 400 },
  pct: { size: 14, line: 17, weight: 800, latin: true },
  caption: { size: 12, line: 15, weight: 400 },
} satisfies Record<string, TextToken>;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  scroll: { paddingBottom: 24 },
  flex: { flex: 1 },
  pressed: { opacity: 0.92 },

  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingStart: 10, paddingEnd: 23, paddingTop: 4 },
  logo: { width: 162, height: 58 },
  bell: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },

  profile: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 24, marginTop: 7 },
  profileText: { flex: 1, gap: 2 },
  profileName: { ...textStyle(T.name), color: colors.textInverse },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  status: { ...textStyle(T.status), color: colors.success },
  statusNeutral: { color: colors.onPrimaryMuted },

  cards: { paddingHorizontal: 20, gap: 16, marginTop: 16 },
  report: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.primary, padding: 18, gap: 12 },
  reportTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reportTitle: { ...textStyle(T.reportTitle), color: colors.primary },
  reportBody: { ...textStyle(T.reportBody), color: '#444444' },
  reportAttention: { color: colors.alertWarning },
  reportHint: { ...textStyle(T.caption), color: colors.textSecondary },

  block: { backgroundColor: colors.surface, borderRadius: 20, padding: 16 },
  empty: { marginHorizontal: 20, marginTop: 24, gap: 16 },
  emptyButton: { minHeight: 56, borderRadius: radius.button, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  emptyButtonText: { ...textStyle(T.blockTitle), color: colors.textInverse },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mapTile: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  blockTitle: { ...textStyle(T.blockTitle), color: colors.textPrimary },
  blockSub: { ...textStyle(T.blockSub), color: colors.textSecondary },

  adherence: { backgroundColor: colors.surface, borderRadius: 20, padding: 18, gap: 12, marginHorizontal: 19, marginTop: 29 },
  adherenceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pct: { ...textStyle(T.pct), color: colors.accent },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.accent },
  caption: { ...textStyle(T.caption), color: colors.textSecondary },
});
