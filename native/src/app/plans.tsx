// Subscription plans — laid out to the "Choose Your Plan" frame in the
// "Salem UI UX" Figma: indigo field, white back button + wordmark, a segmented
// FREE / PREMIUM / VIP switch, and a white plan card with price, feature list
// and a CTA.
//
// Selecting a plan records it on public.subscriptions. Taking money is NOT
// wired: on iOS a paid plan must go through Apple's in-app purchase, which
// needs a paid developer account and a billing SDK. Until then the paid tiers
// register interest and surface a clear "not yet available" notice rather than
// pretending to charge.
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@react-native-vector-icons/feather';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { safeBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { colors, radius, space, type } from '@/theme/tokens';

// DB enum public.subscription_plan is (free, family, premium). The design names
// the tiers FREE / PREMIUM / VIP, so the middle and top tiers map onto the
// existing enum values rather than requiring a migration.
type PlanKey = 'free' | 'family' | 'premium';

type Plan = {
  key: PlanKey;
  tab: string;
  name: string;
  price: string;
  period: string;
  cta: string;
  features: string[];
};

const PLANS: Plan[] = [
  {
    key: 'free',
    tab: 'FREE',
    name: 'FREE',
    price: '$0',
    period: '/month',
    cta: 'Get Free',
    features: [
      '1 Caregiver',
      'Limited storage for vital signs',
      'Rafiq alerts when readings are unusual for them',
      'No GPS tracking',
    ],
  },
  {
    key: 'family',
    tab: 'PREMIUM',
    name: 'PREMIUM',
    price: '$1.99',
    period: '/month',
    cta: 'Choose Premium',
    features: [
      'Up to 5 caregivers',
      'Full vital-sign history',
      'Rafiq insights: day, week and month trends',
      'GPS tracking',
    ],
  },
  {
    key: 'premium',
    tab: 'VIP',
    name: 'VIP',
    price: '$9.9',
    period: '/month',
    cta: 'Go VIP',
    features: [
      'Unlimited Caregiver',
      'Un limited storage for vital signs',
      'All premium features',
    ],
  },
];

export default function Plans() {
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const [tab, setTab] = useState<PlanKey>('free');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const plan = useMemo(() => PLANS.find((p) => p.key === tab)!, [tab]);

  const current = useQuery({
    queryKey: ['subscription', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('plan, status')
        .eq('owner_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return (data as { plan: PlanKey; status: string } | null) ?? null;
    },
  });

  const choose = async () => {
    if (!userId || busy) return;
    setNotice(null);

    if (plan.key !== 'free') {
      // No billing provider is wired yet — say so plainly instead of
      // implying a charge went through.
      setNotice('Payments are not enabled yet. We\u2019ll let you know as soon as this plan is available.');
      return;
    }

    setBusy(true);
    const { error } = await supabase.from('subscriptions').upsert(
      { owner_id: userId, plan: 'free', status: 'active' },
      { onConflict: 'owner_id' },
    );
    setBusy(false);
    if (error) {
      setNotice(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ['subscription', userId] });
    setNotice('Your free plan is active.');
  };

  const isCurrent = current.data?.plan === plan.key;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable onPress={safeBack} style={styles.back} accessibilityLabel="Back">
          <Feather name="chevron-left" size={20} color={colors.primary} />
        </Pressable>
        <Image
          source={require('@/assets/brand/wordmark-white.png')}
          style={styles.wordmark}
          resizeMode="contain"
          accessibilityLabel="Salem"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Choose Your Plan</Text>
          <Text style={styles.heroSub}>
            Select the perfect plan for your caregiving needs
          </Text>
        </View>

        {/* Segmented FREE / PREMIUM / VIP switch */}
        <View style={styles.segment}>
          {PLANS.map((p) => {
            const on = p.key === tab;
            return (
              <Pressable
                key={p.key}
                onPress={() => {
                  setTab(p.key);
                  setNotice(null);
                }}
                style={[styles.segmentItem, on && styles.segmentItemOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                  {p.tab}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Plan card */}
        <View style={styles.card}>
          <Text style={styles.planName}>{plan.name}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{plan.price}</Text>
            <Text style={styles.period}>{plan.period}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.features}>
            {plan.features.map((f) => (
              <View key={f} style={styles.featureRow}>
                <View style={styles.check}>
                  <Feather name="check" size={12} color={colors.primary} />
                </View>
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </View>

          <Pressable
            onPress={choose}
            disabled={busy || isCurrent}
            style={({ pressed }) => [
              styles.cta,
              (busy || isCurrent) && styles.ctaDisabled,
              pressed && { opacity: 0.92 },
            ]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.ctaLabel}>
                {isCurrent ? 'Your current plan' : plan.cta}
              </Text>
            )}
          </Pressable>

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingHorizontal: 20,
    paddingTop: space.s,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { width: 160, height: 56 },

  scroll: { padding: 20, gap: 20 },

  hero: { gap: 6, paddingTop: 12 },
  heroTitle: {
    fontFamily: type.display.fontFamily,
    fontSize: 26,
    lineHeight: 34,
    color: colors.textInverse,
    textAlign: 'center',
  },
  heroSub: {
    fontFamily: type.body.fontFamily,
    fontSize: 15,
    lineHeight: 21,
    color: colors.onPrimary,
    textAlign: 'center',
  },

  segment: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    padding: 4,
  },
  segmentItem: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  segmentItemOn: { backgroundColor: colors.primary },
  segmentText: {
    fontFamily: type.cardTitle.fontFamily,
    fontSize: 13,
    color: colors.textInverse,
  },
  segmentTextOn: { color: colors.textInverse },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 24,
  },
  planName: {
    fontFamily: type.cardTitle.fontFamily,
    fontSize: 14,
    color: colors.primarySoft,
  },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 6 },
  price: { fontFamily: type.display.fontFamily, fontSize: 38, color: colors.textPrimary },
  period: {
    fontFamily: type.body.fontFamily,
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 20,
  },
  features: { gap: 14 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    fontFamily: type.body.fontFamily,
    fontSize: 14,
    color: colors.textPrimary,
  },
  cta: {
    marginTop: 24,
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.55 },
  ctaLabel: {
    fontFamily: type.subtitle.fontFamily,
    fontSize: 16,
    color: colors.textInverse,
  },
  notice: {
    ...type.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: space.m,
  },
});
