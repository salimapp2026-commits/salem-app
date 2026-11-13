// Conversations list — shared by every role (elder, family, doctor). Shows
// each conversation the signed-in user participates in, titled with the OTHER
// participants' names, plus a last-message preview. Tapping opens the thread.
// "New message" lists the people this user may write to (message_contacts).
//
// Restored 2026-10-14 in the Figma shell; same queries as before removal:
//   1. my conversation ids (conversation_participants where user_id = me)
//   2. all participants of those conversations joined to profiles
//   3. recent messages across those conversations; latest per conv client-side
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from '@/navigation/router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@react-native-vector-icons/feather';
import { Avatar } from '@/components/Avatar';
import { FieldCard, FieldEmpty, FieldScreen, SubHeader } from '@/components/dashboard';
import { supabase } from '@/lib/supabase';
import { openConversationWith, useMessageContacts, type MessageContact } from '@/lib/messages';
import { useAuthStore } from '@/stores/authStore';
import { formatTime, isolate, t } from '@/lib/i18n';
import { colors, radius, space, touch, type } from '@/theme/tokens';

type ConvRow = {
  id: string;
  kind: 'family' | 'direct' | 'doctor';
  title: string | null;
  others: { id: string; name: string | null; avatar_url: string | null }[];
  lastMessage: { body: string; at: string; mine: boolean } | null;
};

export default function MessagesList() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user?.id);
  const [picking, setPicking] = useState(false);

  const convs = useQuery<ConvRow[]>({
    queryKey: ['conversations', me],
    enabled: !!me,
    queryFn: async () => {
      // 1. my conversations
      const { data: mine, error } = await supabase
        .from('conversation_participants')
        .select('conversation_id, conversations!inner(id, kind, title)')
        .eq('user_id', me!);
      if (error) throw error;
      const rows = (mine ?? []) as unknown as {
        conversation_id: string;
        conversations: { id: string; kind: ConvRow['kind']; title: string | null };
      }[];
      const ids = rows.map((r) => r.conversation_id);
      if (ids.length === 0) return [];

      // 2. all participants (to label each conversation with the others)
      const { data: parts } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id, profiles!inner(id, display_name, avatar_url)')
        .in('conversation_id', ids);

      // 3. recent messages; newest per conversation client-side
      const { data: msgs } = await supabase
        .from('messages')
        .select('conversation_id, sender_id, body_text, created_at')
        .in('conversation_id', ids)
        .order('created_at', { ascending: false })
        .limit(200);

      const lastByConv = new Map<string, ConvRow['lastMessage']>();
      for (const m of (msgs ?? []) as {
        conversation_id: string; sender_id: string | null; body_text: string | null; created_at: string;
      }[]) {
        if (!lastByConv.has(m.conversation_id)) {
          lastByConv.set(m.conversation_id, {
            body: m.body_text ?? '…',
            at: m.created_at,
            mine: m.sender_id === me,
          });
        }
      }
      const othersByConv = new Map<string, ConvRow['others']>();
      for (const p of (parts ?? []) as unknown as {
        conversation_id: string; user_id: string;
        profiles: { id: string; display_name: string | null; avatar_url: string | null };
      }[]) {
        if (p.user_id === me) continue;
        const list = othersByConv.get(p.conversation_id) ?? [];
        list.push({ id: p.user_id, name: p.profiles.display_name, avatar_url: p.profiles.avatar_url });
        othersByConv.set(p.conversation_id, list);
      }

      const result: ConvRow[] = rows.map((r) => ({
        id: r.conversation_id,
        kind: r.conversations.kind,
        title: r.conversations.title,
        others: othersByConv.get(r.conversation_id) ?? [],
        lastMessage: lastByConv.get(r.conversation_id) ?? null,
      }));
      // Most recent activity first; empty conversations sink to the bottom.
      result.sort((a, b) => (b.lastMessage?.at ?? '').localeCompare(a.lastMessage?.at ?? ''));
      return result;
    },
  });

  // Refresh whenever the screen regains focus (e.g. returning from a thread).
  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
    }, [qc]),
  );

  const labelFor = useMemo(
    () => (c: ConvRow) => {
      if (c.title?.trim()) return c.title;
      if (c.others.length === 0) return t('messages.conversation');
      return c.others.map((o) => isolate(o.name ?? '—')).join(', ');
    },
    [],
  );

  const start = async (c: MessageContact) => {
    setPicking(false);
    const id = await openConversationWith(c.user_id);
    router.push({ pathname: '/messages/[id]', params: { id } });
  };

  return (
    <FieldScreen>
      <SubHeader
        title={t('messages.title')}
        right={
          <Pressable
            onPress={() => setPicking(true)}
            style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={t('messages.new')}
          >
            <Feather name="edit-3" size={16} color={colors.primary} />
            <Text style={styles.newBtnText}>{t('messages.new')}</Text>
          </Pressable>
        }
      />
      <FlatList
        data={convs.data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        refreshing={convs.isFetching}
        onRefresh={() => convs.refetch()}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/messages/[id]', params: { id: item.id } })}
            style={({ pressed }) => [pressed && { opacity: 0.92 }]}
          >
            <FieldCard style={styles.row}>
              <Avatar url={item.others[0]?.avatar_url} displayName={labelFor(item)} size={48} />
              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>{labelFor(item)}</Text>
                <Text style={styles.rowPreview} numberOfLines={1}>
                  {item.lastMessage
                    ? `${item.lastMessage.mine ? t('messages.you') : ''}${item.lastMessage.body}`
                    : t('messages.noMessages')}
                </Text>
              </View>
              {item.lastMessage ? <Text style={styles.rowTime}>{formatTime(item.lastMessage.at)}</Text> : null}
            </FieldCard>
          </Pressable>
        )}
        ListEmptyComponent={<FieldEmpty text={convs.isLoading ? t('common.loading') : t('messages.empty')} />}
      />
      <ContactPicker visible={picking} onClose={() => setPicking(false)} onPick={start} />
    </FieldScreen>
  );
}

function ContactPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (c: MessageContact) => void;
}) {
  const contacts = useMessageContacts(visible);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>{t('messages.pick')}</Text>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.s }}>
            {(contacts.data ?? []).map((c) => (
              <Pressable
                key={c.user_id}
                onPress={() => onPick(c)}
                style={({ pressed }) => [styles.contact, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                <Avatar url={c.avatar_url} displayName={c.display_name} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{isolate(c.display_name ?? '—')}</Text>
                  <Text style={styles.rowPreview} numberOfLines={1}>
                    {t(`messages.relation.${c.relation}`)}
                    {c.relation !== 'elder' && c.elder_name ? ` · ${isolate(c.elder_name)}` : ''}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.textMuted} />
              </Pressable>
            ))}
            {contacts.data && contacts.data.length === 0 ? (
              <Text style={styles.rowPreview}>{t('messages.noContacts')}</Text>
            ) : null}
            {contacts.isLoading ? <Text style={styles.rowPreview}>{t('common.loading')}</Text> : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.m, gap: space.m, paddingBottom: space.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  rowBody: { flex: 1, gap: 2 },
  rowName: { ...type.subtitle, color: colors.textPrimary, textAlign: 'left' },
  rowPreview: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  rowTime: { ...type.micro, color: colors.textMuted },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.m,
    paddingVertical: 8,
  },
  newBtnText: { ...type.cardTitle, color: colors.primary },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: space.l },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.l, gap: space.m },
  sheetTitle: { ...type.title, color: colors.textPrimary, textAlign: 'left' },
  contact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: touch.default,
    padding: space.s,
    borderRadius: radius.m,
    backgroundColor: colors.cream,
  },
});
