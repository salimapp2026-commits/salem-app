// Elder home — Figma "Elder home , medication checklist& care circle" (118:331).
//
//   wordmark · SOS pill + band badge · heart rate / pressure / activity cards ·
//   "Your medication": today's doses, "all taken", "Did you take …?" ·
//   "your care circle": you, a caregiver, a doctor · Call your caregiver / doctor
//
// Real data only (lib/elderHome.ts): no sample numbers, pressure hidden without
// a real reading, call buttons only for a stored number (they open the phone's
// dialer — no in-app calling). Messages, reminders, readings and settings are
// one tap away under More (docs/DESIGN_DIFFERENCES.md).
import { useMemo } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/navigation/router';
import { TabBar, TABS_FOR, type TabKey } from '@/components/dashboard';
import { SosButton } from '@/components/SosButton';
import { VitalCards, bandLine } from '@/components/VitalCards';
import { CareTriangle, DoseClockIcon, DoseTakenIcon, DoubleCheckIcon, PhoneIcon } from '@/components/icons';
import { supabase } from '@/lib/supabase';
import { useCircleCorners, useElderStats, useTodayDoses } from '@/lib/elderHomeData';
import { useAuthStore } from '@/stores/authStore';
import { formatTime, t, tf } from '@/lib/i18n';
import {
  type BandBadge, type Dose, type ElderStats, type Member, dialable, elderDoses, initials,
} from '@/lib/elderHome';
import { colors, elderType, radius, textStyle, touch } from '@/theme/tokens';

export default function ElderHome() {
  const router = useRouter();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  const onTab = (key: TabKey) => {
    if (key === 'rafiq') router.push('/rafiq-chat');
    if (key === 'more') router.push('/(elder)/more');
  };

  const doses = useTodayDoses(userId);
  const plan = useMemo(() => elderDoses(doses.data ?? [], Date.now()), [doses.data]);

  const respond = useMutation({
    mutationFn: async (p: { id: number; status: 'done' | 'snoozed' }) => {
      // "remind me" reminds again later (step32e); "took it" answers the dose.
      const { error } = p.status === 'snoozed'
        ? await supabase.rpc('reminder_snooze', { p_event_id: p.id, p_kind: 'later' })
        : await supabase.rpc('reminder_event_respond', { p_event_id: p.id, p_status: p.status, p_notes: null });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['elder-home-doses', userId] }),
  });

  const stats = useElderStats(userId);
  const circle = useCircleCorners(userId);

  return (
    <ElderHomeView
      plan={plan}
      dosesLoaded={doses.isFetched}
      stats={stats.data ?? null}
      caregiver={circle.data?.caregiver ?? null}
      doctor={circle.data?.doctor ?? null}
      busy={respond.isPending}
      onTook={(id) => respond.mutate({ id, status: 'done' })}
      onRemind={(id) => respond.mutate({ id, status: 'snoozed' })}
      onTab={onTab}
    />
  );
}

export type ElderHomeProps = {
  plan: ReturnType<typeof elderDoses>;
  dosesLoaded: boolean;
  stats: ElderStats | null;
  caregiver: Member | null;
  doctor: Member | null;
  busy: boolean;
  onTook: (id: number) => void;
  onRemind: (id: number) => void;
  onTab: (key: TabKey) => void;
};

/** The screen itself, data in, events out — also rendered by the emulator-only design preview. */
export function ElderHomeView({ plan, dosesLoaded, stats: s, caregiver, doctor, busy, onTook, onRemind, onTab }: ElderHomeProps) {
  const call = (phone: string | null) => phone && void Linking.openURL(`tel:${phone}`);
  const caregiverPhone = dialable(caregiver?.phone_e164);
  const doctorPhone = dialable(doctor?.phone_e164);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.logoRow}>
          <Image source={require('@/assets/brand/wordmark-white.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Salem" />
        </View>

        <View style={styles.sosRow}>
          <SosButton variant="pill" />
          {s && s.band.kind !== 'none' ? (
            <View style={[styles.badge, s.band.kind !== 'connected' && styles.badgeNeutral]}>
              <Text style={[styles.badgeText, s.band.kind !== 'connected' && styles.badgeTextNeutral]}>
                {bandLine(s.band)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.stats}><VitalCards stats={s} side={13} /></View>

        <Text style={styles.sectionTitle}>{t('eh.medsTitle')}</Text>
        <View style={styles.doses}>
          {plan.doses.map((d) => <DoseCard key={d.id} dose={d} />)}
          {dosesLoaded && plan.doses.length === 0 ? (
            <View style={styles.doseCard}><Text style={styles.doseCaption}>{t('eh.noMeds')}</Text></View>
          ) : null}
          {plan.allTaken ? (
            <View style={styles.allTaken}>
              <DoubleCheckIcon />
              <Text style={styles.allTakenText}>{t('eh.allTaken')}</Text>
            </View>
          ) : null}
        </View>

        {plan.ask ? (
          <View style={styles.askCard}>
            <Text style={styles.askText}>{plan.ask.title ? tf('eh.ask', { name: plan.ask.title }) : t('eh.askGeneric')}</Text>
            <Pressable
              onPress={() => onTook(plan.ask!.id)}
              disabled={busy}
              style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.btnPrimaryText}>{t('eh.tookIt')}</Text>
            </Pressable>
            <Pressable
              onPress={() => onRemind(plan.ask!.id)}
              disabled={busy}
              style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.btnSecondaryText}>{t('eh.remindMe')}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.circleHeading}>
          <Text style={styles.pageTitle}>{t('eh.circleTitle')}</Text>
          <Text style={styles.circleSub}>{t('eh.circleSub')}</Text>
        </View>
        <CareCircle
          band={s?.band ?? { kind: 'none' }}
          caregiver={caregiver}
          doctor={doctor}
        />

        {caregiverPhone ? (
          <Pressable onPress={() => call(caregiverPhone)} style={({ pressed }) => [styles.callBtn, styles.callWhite, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.callText}>{t('eh.callCaregiver')}</Text>
            <PhoneIcon />
          </Pressable>
        ) : null}
        {doctorPhone ? (
          <Pressable onPress={() => call(doctorPhone)} style={({ pressed }) => [styles.callBtn, styles.callLavender, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.callText}>{t('eh.callDoctor')}</Text>
            <PhoneIcon />
          </Pressable>
        ) : null}
      </ScrollView>
      <TabBar active="home" onSelect={onTab} tabs={TABS_FOR.elder} />
    </SafeAreaView>
  );
}

function DoseCard({ dose }: { dose: Dose }) {
  const taken = dose.state === 'taken';
  return (
    <View style={styles.doseCard}>
      <View style={[styles.doseTile, taken ? styles.doseTileTaken : styles.doseTilePending]}>
        {taken ? <DoseTakenIcon /> : <DoseClockIcon />}
      </View>
      <View style={styles.doseDetails}>
        <Text style={styles.doseTitle}>{dose.title || t('eh.askGeneric')}</Text>
        <Text style={styles.doseCaption}>{tf('eh.doseAt', { time: formatTime(dose.at) })}</Text>
        {taken ? <Text style={styles.doseStatus}>{t('eh.doseTaken')}</Text> : null}
        {dose.state === 'skipped' ? <Text style={styles.doseCaption}>{t('eh.doseSkipped')}</Text> : null}
        {dose.state === 'missed' ? <Text style={styles.doseCaption}>{t('eh.doseMissed')}</Text> : null}
      </View>
    </View>
  );
}

/** The three-way care circle (design: 352×318 card, positions from the frame). */
function CareCircle({ band, caregiver, doctor }: { band: BandBadge; caregiver: Member | null; doctor: Member | null }) {
  const { width } = useWindowDimensions();
  const cardW = Math.min(width - 41, 420);
  const dx = (cardW - 352) / 2;   // the design's coordinates are for a 352-wide card
  return (
    <View style={[styles.circleCard, { width: cardW }]}>
      <View style={[styles.abs, { left: 93 + dx, top: 125 }]}><CareTriangle /></View>
      <View style={[styles.abs, styles.elderNode, { left: 112 + dx, top: 8 }]}>
        <Text style={styles.youText}>{t('eh.you')}</Text>
        {band.kind === 'connected' || band.kind === 'hc_sync'
          ? <Text style={[styles.youBand, band.kind === 'hc_sync' && styles.youBandNeutral]} numberOfLines={1}>{bandLine(band)}</Text>
          : <View style={styles.youBandSpace} />}
        <View style={[styles.avatar, styles.avatarYou]}>
          <Text style={styles.avatarText}>{t('eh.you')}</Text>
        </View>
      </View>
      <View style={[styles.abs, styles.centre, { left: 141 + dx, top: 161 }]}>
        <Text style={styles.centreText}>{t('eh.centre')}</Text>
      </View>
      <Corner left={8 + dx} member={caregiver} fallbackInitial={t('eh.caregiverInitial')} empty={t('eh.noCaregiver')} tint={colors.sky} />
      <Corner left={212 + dx} member={doctor} fallbackInitial={t('eh.doctorInitial')} empty={t('eh.noDoctor')} tint={colors.lavender} />
    </View>
  );
}

function Corner({ left, member, fallbackInitial, empty, tint }: { left: number; member: Member | null; fallbackInitial: string; empty: string; tint: string }) {
  return (
    <View style={[styles.abs, styles.cornerNode, { left, top: 212 }]}>
      <View style={[styles.avatar, { backgroundColor: tint }]}>
        <Text style={styles.avatarText}>{member ? initials(member.display_name, fallbackInitial) : fallbackInitial}</Text>
      </View>
      <Text style={styles.memberName} numberOfLines={1}>{member?.display_name || empty}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  scroll: { paddingBottom: 24 },
  pressed: { opacity: 0.9 },
  abs: { position: 'absolute' },

  logoRow: { alignItems: 'flex-end', paddingHorizontal: 16, marginTop: 4 },
  logo: { width: 200, height: 72 },

  sosRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingStart: 34, paddingEnd: 22, marginTop: 4 },
  badge: { backgroundColor: colors.mint, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  badgeNeutral: { backgroundColor: colors.lavender },
  badgeText: { ...textStyle(elderType.badge), color: colors.mintInk },
  badgeTextNeutral: { color: colors.inkMuted },

  stats: { marginTop: 42 },

  sectionTitle: { ...textStyle(elderType.sectionTitle), color: colors.textInverse, paddingHorizontal: 12, marginTop: 23 },
  doses: { paddingHorizontal: 18, gap: 18, marginTop: 23 },
  doseCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.doseCard, padding: 18 },
  doseTile: { width: 68, height: 68, borderRadius: radius.stat, alignItems: 'center', justifyContent: 'center' },
  doseTileTaken: { backgroundColor: colors.mint },
  doseTilePending: { backgroundColor: colors.lavender },
  doseDetails: { flex: 1, gap: 4 },
  doseTitle: { ...textStyle(elderType.doseTitle), color: colors.ink },
  doseCaption: { ...textStyle(elderType.caption), color: colors.inkMuted },
  doseStatus: { ...textStyle(elderType.caption), color: colors.mintInk },
  allTaken: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.mint, borderRadius: radius.stat, padding: 16, minHeight: 88 },
  allTakenText: { ...textStyle(elderType.body), color: colors.mintInk, flex: 1 },

  askCard: { backgroundColor: colors.surface, borderRadius: radius.panel, padding: 20, gap: 12, marginHorizontal: 16, marginTop: 17 },
  askText: { ...textStyle(elderType.question), color: colors.ink },
  btn: { borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 10 },
  btnPrimary: { backgroundColor: colors.primary, minHeight: 72 },
  btnPrimaryText: { ...textStyle(elderType.actionLarge), color: colors.textInverse },
  btnSecondary: { backgroundColor: colors.lavender, minHeight: touch.elderMin },
  btnSecondaryText: { ...textStyle(elderType.action), color: colors.primary },

  circleHeading: { paddingTop: 18, paddingBottom: 20, paddingHorizontal: 24, gap: 12, marginTop: 23 },
  pageTitle: { ...textStyle(elderType.pageTitle), color: colors.textInverse },
  circleSub: { ...textStyle(elderType.caption), color: colors.textInverse },
  circleCard: { height: 318, alignSelf: 'center', backgroundColor: colors.surface, borderRadius: radius.panel },
  elderNode: { width: 128, alignItems: 'center', gap: 1 },
  youText: { ...textStyle(elderType.you), color: colors.ink },
  youBand: { ...textStyle({ size: 12, line: 20, weight: 400 }), color: colors.mintInk },
  youBandNeutral: { color: colors.inkMuted },
  youBandSpace: { height: 20 },
  centre: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.sky, alignItems: 'center', justifyContent: 'center' },
  centreText: { ...textStyle(elderType.centre), color: colors.primary },
  cornerNode: { width: 132, alignItems: 'center', gap: 1 },
  avatar: { width: 66, height: 66, borderRadius: 33, borderWidth: 3, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  avatarYou: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.lavender },
  avatarText: { ...textStyle(elderType.avatarInitial), color: colors.primary },
  memberName: { ...textStyle(elderType.memberName), color: colors.ink, textAlign: 'center' },

  callBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 72,
    borderRadius: radius.button, paddingHorizontal: 18, paddingVertical: 10, marginHorizontal: 30, marginTop: 20,
  },
  callWhite: { backgroundColor: colors.surface },
  callLavender: { backgroundColor: colors.lavender },
  callText: { ...textStyle(elderType.actionLarge), color: colors.primary },
});
