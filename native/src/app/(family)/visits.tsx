// Family-side visits list. Lists every doctor_visits row the user can read
// via has_perm — i.e. visits for any elder in any care circle they're a
// member of. Tapping a row routes to the doctor visit detail screen, which
// is read-only and lives under (doctor) but is reachable for anyone with
// access (the route group prefix is just for tab navigation, not auth).
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from '@/navigation/router';
import { useQuery } from '@tanstack/react-query';
import { FieldCard, FieldEmpty, FieldScreen, SubHeader } from '@/components/dashboard';
import { supabase } from '@/lib/supabase';
import { colors, space, type } from '@/theme/tokens';
import { isolate, t } from '@/lib/i18n';

type VisitRow = {
  id: string;
  visit_date: string;
  symptoms: string | null;
  notes: string | null;
  doctor_name: string | null;
  elder: { id: string; display_name: string | null } | null;
};

export default function FamilyVisits() {
  const router = useRouter();

  const visits = useQuery<VisitRow[]>({
    queryKey: ['family-visits'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('doctor_visits')
        .select(
          'id, visit_date, symptoms, notes, doctor_name, elder:profiles!doctor_visits_elder_id_fkey(id, display_name)',
        )
        .order('visit_date', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  return (
    <FieldScreen>
      <SubHeader title="Doctor visits" />
      <FlatList
        data={visits.data ?? []}
        keyExtractor={(v) => v.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/(doctor)/visit/[visitId]',
                params: { visitId: item.id },
              })
            }
            style={({ pressed }) => [pressed && { opacity: 0.92 }]}
          >
            <FieldCard style={styles.row}>
              <View style={styles.rowHead}>
                <Text style={styles.date}>{item.visit_date}</Text>
                {item.elder?.display_name ? (
                  <Text style={styles.elderName}>{item.elder.display_name}</Text>
                ) : null}
              </View>
              {item.doctor_name?.trim() ? (
                <Text style={styles.doctorLine}>Dr. {isolate(item.doctor_name)}</Text>
              ) : null}
              {item.symptoms ? (
                <Text style={styles.body} numberOfLines={2}>
                  {item.symptoms}
                </Text>
              ) : null}
              {item.notes ? (
                <Text style={styles.muted} numberOfLines={2}>
                  {item.notes}
                </Text>
              ) : null}
            </FieldCard>
          </Pressable>
        )}
        ListEmptyComponent={
          <FieldEmpty text={visits.isLoading ? t('common.loading') : 'No visits yet'} />
        }
        refreshing={visits.isFetching}
        onRefresh={() => visits.refetch()}
      />
    </FieldScreen>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.m, gap: space.m, paddingBottom: space.xxl },
  row: { gap: space.s },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between' },
  date: { ...type.subtitle, color: colors.textPrimary },
  elderName: { ...type.body, color: colors.textSecondary },
  doctorLine: { ...type.body, color: colors.textSecondary, textAlign: 'left' },
  body: { ...type.body, color: colors.textPrimary, textAlign: 'left' },
  muted: { ...type.body, color: colors.textSecondary, textAlign: 'left' },
});
