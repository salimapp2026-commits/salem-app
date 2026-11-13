// Bottom-sheet detail for a notification on the family/doctor side.
// Marks as read, and if the source is a health alert, exposes an
// "acknowledge" action that calls acknowledge_health_alert.
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, touch, type } from '@/theme/tokens';
import { formatDateTime } from '@/lib/i18n';

type NotificationRow = {
  id: string;
  title_ar: string;
  body_ar: string;
  severity: 'info' | 'warning' | 'critical';
  source_kind: string;
  source_id: string | null;
  read_at: string | null;
  sent_at: string;
};

type Props = {
  notification: NotificationRow | null;
  onClose: () => void;
};

export function NotificationDetail({ notification, onClose }: Props) {
  const qc = useQueryClient();

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_notification_read', {
        p_notification_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recent_notifications'] }),
  });

  const acknowledge = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase.rpc('acknowledge_health_alert', {
        p_alert_id: alertId,
        p_resolved: true,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recent_notifications'] }),
  });

  const visible = !!notification;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropPress} onPress={onClose} />
        <View style={styles.sheet}>
          {notification ? (
            <>
              <Text style={[styles.severity, severityStyle(notification.severity)]}>
                {severityLabel(notification.severity)}
              </Text>
              <Text style={styles.title}>{notification.title_ar}</Text>
              <Text style={styles.body}>{notification.body_ar}</Text>
              <Text style={styles.meta}>
                {formatDateTime(notification.sent_at)}
              </Text>

              <View style={styles.actions}>
                {!notification.read_at ? (
                  <Pressable
                    style={[styles.btn, styles.btnSecondary]}
                    onPress={() =>
                      !markRead.isPending && markRead.mutate(notification.id)
                    }
                  >
                    {markRead.isPending ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <Text style={styles.btnSecondaryLabel}>Mark as read</Text>
                    )}
                  </Pressable>
                ) : null}

                {notification.source_kind === 'health_alert' && notification.source_id ? (
                  <Pressable
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={() =>
                      !acknowledge.isPending &&
                      notification.source_id &&
                      acknowledge.mutate(notification.source_id)
                    }
                  >
                    {acknowledge.isPending ? (
                      <ActivityIndicator color={colors.textInverse} />
                    ) : (
                      <Text style={styles.btnPrimaryLabel}>Acknowledge</Text>
                    )}
                  </Pressable>
                ) : null}

                <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}>
                  <Text style={styles.btnGhostLabel}>Close</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function severityLabel(s: NotificationRow['severity']) {
  if (s === 'critical') return 'Critical';
  if (s === 'warning') return 'Warning';
  return 'Info';
}

function severityStyle(s: NotificationRow['severity']) {
  if (s === 'critical') return { color: colors.alertCritical };
  if (s === 'warning') return { color: colors.alertWarning };
  return { color: colors.alertInfo };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  backdropPress: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    padding: space.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    gap: space.m,
  },
  severity: { ...type.caption, fontWeight: '700', textAlign: 'left' },
  title: { ...type.title, color: colors.textPrimary, textAlign: 'left' },
  body: { ...type.bodyLarge, color: colors.textSecondary, textAlign: 'left' },
  meta: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  actions: { gap: space.m, marginTop: space.m },
  btn: {
    minHeight: touch.elderMin,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.l,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryLabel: { ...type.subtitle, color: colors.textInverse },
  btnSecondary: { backgroundColor: colors.surfaceMuted },
  btnSecondaryLabel: { ...type.subtitle, color: colors.primary },
  btnGhost: { backgroundColor: 'transparent' },
  btnGhostLabel: { ...type.subtitle, color: colors.textSecondary },
});

export type { NotificationRow };
