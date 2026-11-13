// The elder's "More" tab (the design's dashboard-grid tab). The elder home in
// the design has no messages, notifications, reminders or readings; they live
// here, one tap from home, in the Settings frame's row style
// (docs/DESIGN_DIFFERENCES.md). Messaging is core and stays.
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@/navigation/router';
import { MenuRow, ScreenHeader } from '@/components/screenParts';
import { TabBar, TABS_FOR, type TabKey } from '@/components/dashboard';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { t } from '@/lib/i18n';
import { colors } from '@/theme/tokens';

export default function ElderMore() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  const unread = useQuery({
    queryKey: ['unread', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.rpc('unread_notification_count', { p_elder_id: userId });
      return (data as number | null) ?? 0;
    },
  });
  const onTab = (key: TabKey) => {
    if (key === 'home') router.push('/(elder)');
    if (key === 'rafiq') router.push('/rafiq-chat');
  };
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={t('tab.more')} />
      <ScrollView contentContainerStyle={styles.list}>
        <MenuRow icon="message-circle" label={t('messages.title')} onPress={() => router.push('/messages')} />
        <MenuRow icon="bell" label={t('more.notifications')} badge={unread.data || undefined} onPress={() => router.push('/notifications')} />
        <MenuRow icon="clock" label={t('more.reminders')} onPress={() => router.push('/(elder)/reminders')} />
        <MenuRow icon="plus-circle" label={t('more.medicines')} onPress={() => router.push('/medicines')} />
        <MenuRow icon="file-text" label={t('more.medications')} onPress={() => router.push('/(elder)/prescriptions')} />
        <MenuRow icon="heart" label={t('more.addReading')} onPress={() => router.push('/(elder)/vitals')} />
        <MenuRow icon="user-plus" label={t('more.addMember')} onPress={() => router.push('/link/add')} />
        <MenuRow icon="log-in" label={t('more.beInvited')} onPress={() => router.push('/link/join')} />
        <MenuRow icon="settings" label={t('common.settings')} onPress={() => router.push('/settings')} />
      </ScrollView>
      <TabBar active="more" onSelect={onTab} tabs={TABS_FOR.elder} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  list: { paddingHorizontal: 22, gap: 20, paddingBottom: 24 },
});
