// Notifications — opened from the bell in the brand header.
//
// Lists everything recent_notifications() returns for the signed-in user and
// opens the existing detail sheet (mark-read / acknowledge) on tap.
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@react-native-vector-icons/feather';
import { useQuery } from '@tanstack/react-query';
import { safeBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import { NotificationDetail, type NotificationRow } from '@/components/NotificationDetail';
import { colors, radius, space, type } from '@/theme/tokens';
import { formatDateTime } from '@/lib/i18n';

export default function Notifications() {
  const [active, setActive] = useState<NotificationRow | null>(null);

  const feed = useQuery({
    queryKey: ['recent_notifications'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recent_notifications', { p_limit: 100 });
      if (error) throw error;
      return (data ?? []) as NotificationRow[];
    },
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.nav}>
        <Pressable onPress={safeBack} style={styles.back} accessibilityLabel="Back">
          <Feather name="chevron-left" size={20} color={colors.primary} />
        </Pressable>
        <Text style={styles.navTitle}>Notifications</Text>
        <View style={styles.navSpacer} />
      </View>

      <FlatList
        data={feed.data ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        refreshing={feed.isFetching}
        onRefresh={() => feed.refetch()}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setActive(item)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.92 }]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.title_ar}</Text>
              <Text style={styles.rowBody} numberOfLines={2}>{item.body_ar}</Text>
              <Text style={styles.rowMeta}>{formatDateTime(item.sent_at)}</Text>
            </View>
            {!item.read_at ? <View style={styles.unread} /> : null}
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="bell" size={28} color={colors.onPrimaryMuted} />
            <Text style={styles.emptyText}>
              {feed.isLoading ? 'Loading...' : 'No notifications yet'}
            </Text>
          </View>
        }
      />

      <NotificationDetail notification={active} onClose={() => setActive(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.l,
    paddingVertical: 12,
  },
  back: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  navTitle: { fontFamily: type.title.fontFamily, fontSize: 16, color: colors.textInverse },
  navSpacer: { width: 36, height: 36 },

  list: { padding: 20, gap: space.s, flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.s,
    backgroundColor: colors.surface, borderRadius: radius.m, padding: space.m,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.cardTitle, color: colors.textPrimary },
  rowBody: { ...type.cardBody, color: colors.textSecondary },
  rowMeta: { fontFamily: type.micro.fontFamily, fontSize: 11, color: colors.textMuted, marginTop: 2 },
  unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s },
  emptyText: { ...type.body, color: colors.onPrimaryMuted },
});
