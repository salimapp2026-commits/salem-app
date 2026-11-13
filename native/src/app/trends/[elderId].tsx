// Trend Watch detail — opened from the caregiver dashboard's "Trends" card.
// One 28-day chart per metric with the usual range shaded, the plain-language
// explanation and the allowed next steps. Data is read-health protected by RLS.
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from '@/navigation/router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { FieldCard, FieldEmpty, FieldScreen, SubHeader } from '@/components/dashboard';
import { TrendsPanel } from '@/components/trends/TrendsPanel';
import { supabase } from '@/lib/supabase';
import { t } from '@/lib/i18n';
import { colors, space, type } from '@/theme/tokens';

export default function TrendsScreen() {
  const { elderId } = useLocalSearchParams<{ elderId: string }>();
  const router = useRouter();

  const elder = useQuery({
    queryKey: ['trend-elder', elderId],
    enabled: !!elderId,
    queryFn: async () => {
      const [{ data: profile }, { data: feature }] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', elderId!).maybeSingle(),
        supabase.rpc('has_feature', { p_elder_id: elderId, p_feature: 'trend_watch' }),
      ]);
      return { name: (profile?.display_name as string | undefined) ?? '', feature: feature === true };
    },
  });

  return (
    <FieldScreen>
      <SubHeader title={t('trends.title')} />
      <ScrollView contentContainerStyle={styles.body}>
        {!elderId || elder.isLoading ? (
          <FieldEmpty text={t('common.loading')} />
        ) : elder.data && !elder.data.feature ? (
          // Premium / VIP feature. has_feature() returns true until payments exist.
          <FieldCard>
            <Text style={styles.text}>{t('trends.title')}</Text>
            <Button label="Subscription & plans" onPress={() => router.push('/plans')} />
          </FieldCard>
        ) : (
          <TrendsPanel elderId={elderId} elderName={elder.data?.name ?? ''} />
        )}
      </ScrollView>
    </FieldScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.m, paddingBottom: space.xxl },
  text: { ...type.cardTitle, color: colors.textPrimary, textAlign: 'left' },
});
