// The caregiver's "More" tab (the design's dashboard-grid tab): what the
// caregiver home in the design doesn't show — messages, alerts, the care
// circle, doctor visits, notifications, settings (docs/DESIGN_DIFFERENCES.md).
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@/navigation/router';
import { MenuRow, ScreenHeader } from '@/components/screenParts';
import { TabBar, TABS_FOR, type TabKey } from '@/components/dashboard';
import { supabase } from '@/lib/supabase';
import { t } from '@/lib/i18n';
import { elderIdsIManage } from '@/lib/medicines';
import { useAuthStore } from '@/stores/authStore';
import { colors } from '@/theme/tokens';

export default function FamilyMore() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  // Medicines: only for the primary caretaker (founder, 2026-11-04).
  const manages = useQuery({
    queryKey: ['medicine_elders', userId, false],
    enabled: !!userId,
    queryFn: () => elderIdsIManage(userId!, false),
  });
  const unread = useQuery({
    queryKey: ['unread'],
    queryFn: async () => {
      const { data } = await supabase.rpc('unread_notification_count');
      return (data as number | null) ?? 0;
    },
  });
  const onTab = (key: TabKey) => {
    if (key === 'home') router.push('/(family)');
    if (key === 'rafiq') router.push('/rafiq-chat');
    if (key === 'map') router.push('/location');
  };
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={t('tab.more')} />
      <ScrollView contentContainerStyle={styles.list}>
        <MenuRow icon="message-circle" label={t('messages.title')} onPress={() => router.push('/messages')} />
        <MenuRow icon="alert-triangle" label={t('more.alerts')} onPress={() => router.push('/(family)/alerts')} />
        <MenuRow icon="bell" label={t('more.notifications')} badge={unread.data || undefined} onPress={() => router.push('/notifications')} />
        {(manages.data ?? []).length > 0 ? (
          <MenuRow icon="plus-circle" label={t('more.medicines')} onPress={() => router.push('/medicines')} />
        ) : null}
        <MenuRow icon="users" label={t('more.circle')} onPress={() => router.push('/(family)/circle')} />
        <MenuRow icon="user-plus" label={t('more.addMember')} onPress={() => router.push('/link/add')} />
        <MenuRow icon="log-in" label={t('more.beInvited')} onPress={() => router.push('/link/join')} />
        <MenuRow icon="clipboard" label={t('more.visits')} onPress={() => router.push('/(family)/visits')} />
        <MenuRow icon="settings" label={t('common.settings')} onPress={() => router.push('/settings')} />
      </ScrollView>
      <TabBar active="more" onSelect={onTab} tabs={TABS_FOR.family} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  list: { paddingHorizontal: 22, gap: 20, paddingBottom: 24 },
});
