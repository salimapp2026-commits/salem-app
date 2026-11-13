// Single conversation thread. Messages load oldest-first, a realtime INSERT
// subscription appends new ones live (the `messages` table is in the
// supabase_realtime publication, and RLS scopes events to participants).
// Composer inserts directly — RLS messages_insert verifies participation.
// Restored 2026-10-14 in the Figma shell (English LTR).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from '@/navigation/router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FieldScreen, SubHeader } from '@/components/dashboard';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { formatTime, isolate, t } from '@/lib/i18n';
import { colors, radius, space, touch, type } from '@/theme/tokens';

type Msg = {
  id: string;
  sender_id: string | null;
  body_text: string | null;
  created_at: string;
  sender?: { display_name: string | null } | null;
};

export default function MessageThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<FlatList<Msg>>(null);

  const msgs = useQuery<Msg[]>({
    queryKey: ['thread', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, sender_id, body_text, created_at, sender:profiles!messages_sender_id_fkey(display_name)')
        .eq('conversation_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as Msg[];
    },
  });

  // Participants for the header title (the other people in the thread).
  const others = useQuery<string>({
    queryKey: ['thread-others', id],
    enabled: !!id && !!me,
    queryFn: async () => {
      const { data } = await supabase
        .from('conversation_participants')
        .select('user_id, profiles!inner(display_name)')
        .eq('conversation_id', id);
      const names = ((data ?? []) as unknown as {
        user_id: string;
        profiles: { display_name: string | null };
      }[])
        .filter((p) => p.user_id !== me)
        .map((p) => isolate(p.profiles.display_name ?? '—'));
      return names.join(', ') || t('messages.conversation');
    },
  });

  // Live updates: append new messages for this conversation as they arrive.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`thread:${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['thread', id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, qc]);

  useEffect(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [msgs.data?.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !id || !me) return;
    setDraft('');
    setFailed(false);
    setSending(true);
    try {
      const { error } = await supabase.from('messages').insert({
        conversation_id: id,
        sender_id: me,
        kind: 'text',
        body_text: body,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['thread', id] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch {
      setDraft(body); // give their text back so nothing is lost
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  const data = useMemo(() => msgs.data ?? [], [msgs.data]);
  const canSend = !!draft.trim() && !sending;

  return (
    <FieldScreen>
      <SubHeader title={others.data ?? t('common.loading')} />
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <FlatList
          ref={listRef}
          data={data}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const mine = item.sender_id === me;
            return (
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                {!mine && item.sender?.display_name ? (
                  <Text style={styles.senderName}>{isolate(item.sender.display_name)}</Text>
                ) : null}
                <Text style={mine ? styles.mineText : styles.theirsText}>{item.body_text ?? '…'}</Text>
                <Text style={[styles.time, mine && styles.mineTime]}>{formatTime(item.created_at)}</Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.muted}>{msgs.isLoading ? t('common.loading') : t('messages.noMessages')}</Text>
            </View>
          }
        />

        {failed ? <Text style={styles.error}>{t('messages.sendFailed')}</Text> : null}
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('messages.placeholder')}
            placeholderTextColor={colors.textSecondary}
            multiline
            style={styles.input}
            editable={!sending}
            accessibilityLabel={t('messages.placeholder')}
          />
          <Pressable
            onPress={send}
            disabled={!canSend}
            style={({ pressed }) => [styles.sendBtn, !canSend && styles.disabled, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={t('messages.send')}
          >
            <Text style={styles.sendLabel}>{t('messages.send')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </FieldScreen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, backgroundColor: colors.cream, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  list: { padding: space.m, gap: space.m, flexGrow: 1 },
  bubble: {
    maxWidth: '82%',
    paddingVertical: space.m,
    paddingHorizontal: space.m,
    borderRadius: radius.xl,
    gap: 2,
  },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  senderName: { ...type.caption, color: colors.primary, textAlign: 'left', fontWeight: '700' },
  mineText: { ...type.bodyLarge, color: colors.textInverse, textAlign: 'left' },
  theirsText: { ...type.bodyLarge, color: colors.textPrimary, textAlign: 'left' },
  time: { ...type.micro, color: colors.textSecondary, textAlign: 'right' },
  mineTime: { color: 'rgba(255,255,255,0.75)' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: space.xxl },
  muted: { ...type.body, color: colors.textSecondary },
  error: { ...type.caption, color: colors.alertCritical, paddingHorizontal: space.m },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.s,
    padding: space.m,
    backgroundColor: colors.cream,
  },
  input: {
    flex: 1,
    minHeight: touch.elderMin,
    maxHeight: 140,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: space.m,
    paddingVertical: space.m,
    ...type.body,
    color: colors.textPrimary,
    textAlign: 'left',
  },
  sendBtn: {
    minHeight: touch.elderMin,
    paddingHorizontal: space.l,
    borderRadius: radius.xl,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  sendLabel: { ...type.subtitle, color: colors.textInverse },
});
