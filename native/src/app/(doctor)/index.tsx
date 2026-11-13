// Doctor home — laid out to the "Salem UI UX" Figma list screen: indigo field,
// brand header with SOS + bell, a search field, outlined filter chips, white
// patient cards and the bottom tab bar.
//
// Lists the elders this doctor is in the care circle of
// (care_circle_members.member_role = 'doctor'). Doctors never see location.
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@/navigation/router';
import { Avatar } from '@/components/Avatar';
import {
  BrandHeader,
  FilterChips,
  SearchField,
  TabBar,
  TABS_FOR,
  type TabKey,
} from '@/components/dashboard';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { colors, radius, space, type } from '@/theme/tokens';
import { t } from '@/lib/i18n';

type Patient = {
  elder_id: string;
  display_name: string;
  date_of_birth: string | null;
};

type Filter = 'all' | 'recent' | 'alerts' | 'messages';

export default function DoctorHome() {
  const userId = useAuthStore((s) => s.user?.id);
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('home');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const patients = useQuery({
    queryKey: ['doctor_patients', userId],
    enabled: !!userId,
    queryFn: async (): Promise<Patient[]> => {
      const { data, error } = await supabase
        .from('care_circle_members')
        .select(
          'circle:care_circles!inner(elder:profiles!care_circles_elder_id_fkey(id, display_name, date_of_birth))',
        )
        .eq('user_id', userId)
        .eq('member_role', 'doctor')
        .eq('status', 'active');
      if (error) throw error;
      type Row = { circle: { elder: Patient & { id: string } } };
      return (data ?? []).map((row: unknown) => {
        const r = row as Row;
        return {
          elder_id: r.circle.elder.id,
          display_name: r.circle.elder.display_name,
          date_of_birth: r.circle.elder.date_of_birth,
        };
      });
    },
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = patients.data ?? [];
    return q ? list.filter((p) => (p.display_name ?? '').toLowerCase().includes(q)) : list;
  }, [patients.data, query]);

  const onTab = (key: TabKey) => {
    if (key === 'home') {
      setTab('home');
      return;
    }
    // Rafiq is per patient: it lives in each patient file's Trends tab.
    if (key === 'rafiq') router.push('/rafiq-chat');
    if (key === 'more') router.push('/settings');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BrandHeader onBellPress={() => router.push('/notifications')} />

      <View style={styles.controls}>
        <SearchField value={query} onChangeText={setQuery} placeholder="search patients" />
        <FilterChips<Filter>
          items={[
            { key: 'all', label: 'All', icon: 'users' },
            { key: 'recent', label: 'Recent', icon: 'clock' },
            { key: 'alerts', label: 'Alerts', icon: 'bell' },
            { key: 'messages', label: 'Messages', icon: 'message-square' },
          ]}
          active={filter}
          onSelect={(k) => {
            setFilter(k);
            if (k === 'alerts') router.push('/(doctor)/alerts');
            if (k === 'messages') router.push('/messages');
          }}
        />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(p) => p.elder_id}
        contentContainerStyle={styles.list}
        refreshing={patients.isFetching}
        onRefresh={() => patients.refetch()}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/(doctor)/patient/${item.elder_id}`)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
          >
            <Avatar displayName={item.display_name} size={44} />
            <View style={styles.cardText}>
              <Text style={styles.name} numberOfLines={1}>
                {item.display_name}
              </Text>
              {item.date_of_birth ? (
                <Text style={styles.meta}>Date of birth: {item.date_of_birth}</Text>
              ) : (
                <Text style={styles.meta}>Tap to open patient file</Text>
              )}
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {patients.isLoading
                ? t('common.loading')
                : patients.error
                  ? String((patients.error as Error).message)
                  : query
                    ? 'No patients match that search'
                    : 'No patients in your list yet'}
            </Text>
          </View>
        }
        ListFooterComponent={
          <Pressable style={styles.inviteRow} onPress={() => router.push('/link/join')}>
            <Text style={styles.inviteLabel}>Accept a patient invite</Text>
          </Pressable>
        }
      />

      <TabBar active={tab} onSelect={onTab} tabs={TABS_FOR.doctor} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  controls: { paddingHorizontal: 20, gap: space.s, paddingBottom: space.m },
  list: { paddingHorizontal: 20, paddingBottom: space.l, gap: space.m, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: space.m,
  },
  cardText: { flex: 1, gap: 2 },
  name: { ...type.cardTitle, color: colors.textPrimary },
  meta: { ...type.cardBody, color: colors.textSecondary },
  chevron: { fontFamily: type.title.fontFamily, fontSize: 22, color: colors.primary },
  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { ...type.body, color: colors.onPrimaryMuted, textAlign: 'center' },
  inviteRow: {
    marginTop: space.m,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  inviteLabel: { fontFamily: type.subtitle.fontFamily, fontSize: 14, color: colors.textInverse },
});
