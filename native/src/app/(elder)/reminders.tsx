// Today's reminders. Pulls upcoming_reminder_events for the next 24h and
// lets the elder mark each one done / skipped / snoozed via
// reminder_event_respond. Status chips are color-coded; pending due items
// show a primary "Done" button.
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FieldCard, FieldEmpty, FieldScreen, SubHeader } from '@/components/dashboard';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { colors, radius, space, touch, type } from '@/theme/tokens';
import { formatTime, t } from '@/lib/i18n';

type EventStatus = 'pending' | 'done' | 'skipped' | 'snoozed' | 'missed';
type ReminderEvent = {
  id: number;
  reminder_id: string;
  elder_id: string;
  scheduled_at: string;
  status: EventStatus;
  notes: string | null;
};

export default function Reminders() {
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();

  const list = useQuery<ReminderEvent[]>({
    queryKey: ['upcoming_reminder_events', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('upcoming_reminder_events', {
        p_elder_id: userId,
        p_horizon_hours: 24,
      });
      if (error) throw error;
      return (data ?? []) as ReminderEvent[];
    },
  });

  const respond = useMutation({
    mutationFn: async (params: { id: number; status: EventStatus }) => {
      const { error } = await supabase.rpc('reminder_event_respond', {
        p_event_id: params.id,
        p_status: params.status,
        p_notes: null,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['upcoming_reminder_events', userId] }),
  });

  return (
    <FieldScreen>
      <SubHeader title="Today’s reminders" />
      <FlatList
        data={list.data ?? []}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <Row event={item} onRespond={respond.mutate} />}
        ListEmptyComponent={
          <FieldEmpty text={list.isLoading ? t('common.loading') : 'No reminders today'} />
        }
        refreshing={list.isFetching}
        onRefresh={() => list.refetch()}
      />
    </FieldScreen>
  );
}

function Row({
  event,
  onRespond,
}: {
  event: ReminderEvent;
  onRespond: (p: { id: number; status: EventStatus }) => void;
}) {
  const dueNow =
    event.status === 'pending' && new Date(event.scheduled_at).getTime() <= Date.now();
  return (
    <FieldCard style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.time}>{formatTime(event.scheduled_at)}</Text>
        <StatusChip status={event.status} />
      </View>
      <Text style={styles.notes}>
        {event.notes ?? 'Reminder'}
      </Text>
      {event.status === 'pending' ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => onRespond({ id: event.id, status: 'done' })}
            style={[styles.action, styles.actionPrimary]}
          >
            <Text style={styles.actionPrimaryLabel}>Done</Text>
          </Pressable>
          <Pressable
            onPress={() => onRespond({ id: event.id, status: 'skipped' })}
            style={[styles.action, styles.actionSecondary]}
          >
            <Text style={styles.actionSecondaryLabel}>Skip</Text>
          </Pressable>
          {!dueNow ? null : (
            <Pressable
              onPress={() => onRespond({ id: event.id, status: 'snoozed' })}
              style={[styles.action, styles.actionGhost]}
            >
              <Text style={styles.actionGhostLabel}>Snooze</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </FieldCard>
  );
}

function StatusChip({ status }: { status: EventStatus }) {
  const map: Record<EventStatus, { label: string; color: string; bg: string }> = {
    pending:  { label: 'Pending', color: colors.primary,       bg: colors.surfaceMuted },
    done:     { label: 'Done',    color: colors.textInverse,   bg: colors.primary },
    skipped:  { label: 'Skipped', color: colors.textSecondary, bg: colors.surfaceMuted },
    snoozed:  { label: 'Snoozed', color: colors.alertWarning,  bg: colors.surfaceMuted },
    missed:   { label: 'Missed',  color: colors.textInverse,   bg: colors.alertCritical },
  };
  const m = map[status];
  return (
    <View style={[styles.chip, { backgroundColor: m.bg }]}>
      <Text style={[styles.chipLabel, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.m, paddingBottom: space.xxl, gap: space.m },
  row: { gap: space.m },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { ...type.title, color: colors.textPrimary },
  chip: { paddingHorizontal: space.m, paddingVertical: space.xs, borderRadius: radius.pill },
  chipLabel: { ...type.caption, fontWeight: '700' },
  notes: { ...type.bodyLarge, color: colors.textSecondary, textAlign: 'left' },
  actions: { flexDirection: 'row', gap: space.s },
  action: {
    flex: 1,
    minHeight: touch.elderMin,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryLabel: { ...type.subtitle, color: colors.textInverse },
  actionSecondary: { backgroundColor: colors.surfaceMuted },
  actionSecondaryLabel: { ...type.subtitle, color: colors.primary },
  actionGhost: { backgroundColor: 'transparent' },
  actionGhostLabel: { ...type.subtitle, color: colors.textSecondary },
});
