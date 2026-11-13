// Elder's prescriptions — read-only list of meds prescribed by their doctors.
// RLS lets the elder see their own (elder_id = auth.uid()). Family members
// with health perm reach the same data through the doctor drilldown; this
// screen is the elder's own view.
import { FlatList, StyleSheet, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { FieldCard, FieldEmpty, FieldScreen, SubHeader } from '@/components/dashboard';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { listPrescriptions, type Prescription } from '@/lib/prescriptions';
import { colors, space, type } from '@/theme/tokens';
import { formatDate, isolate, t } from '@/lib/i18n';

export default function ElderPrescriptions() {
  const me = useAuthStore((s) => s.user?.id);

  const rx = useQuery<Prescription[]>({
    queryKey: ['my-prescriptions', me],
    enabled: !!me,
    queryFn: () => listPrescriptions(me!),
  });

  return (
    <FieldScreen>
      <SubHeader title="My medications" />
      <FlatList
        data={rx.data ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <FieldCard style={styles.row}>
            <Text style={styles.med}>{item.medication_name}</Text>
            {item.dosage ? <Text style={styles.dosage}>{item.dosage}</Text> : null}
            {item.instructions ? (
              <Text style={styles.instructions}>{item.instructions}</Text>
            ) : null}
            <Text style={styles.meta}>
              {item.prescriber?.display_name
                ? `Dr. ${isolate(item.prescriber.display_name)} · `
                : ''}
              {formatDate(item.prescribed_at)}
            </Text>
          </FieldCard>
        )}
        ListEmptyComponent={
          <FieldEmpty text={rx.isLoading ? t('common.loading') : 'No prescriptions yet.'} />
        }
        refreshing={rx.isFetching}
        onRefresh={() => rx.refetch()}
      />
    </FieldScreen>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.m, gap: space.m, paddingBottom: space.xxl },
  row: { gap: space.xs },
  med: { ...type.title, color: colors.textPrimary, textAlign: 'left' },
  dosage: { ...type.bodyLarge, color: colors.primary, textAlign: 'left' },
  instructions: { ...type.body, color: colors.textPrimary, textAlign: 'left' },
  meta: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
});
