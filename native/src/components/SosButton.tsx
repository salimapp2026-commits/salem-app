// SOS button. Shows a confirmation modal before firing — accidental taps are
// common with elderly users so we never single-tap-launch an alert.
//
// Two shapes, same behaviour:
//   "fab"  — the floating circle on the elder home.
//   "pill" — the red header pill from the Figma dashboard/doctor screens.
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AlarmClockPlusIcon } from '@/components/icons';
import { supabase } from '@/lib/supabase';
import { currentPosition } from '@/lib/currentPosition';
import { useAuthStore } from '@/stores/authStore';
import { colors, radius, shadow, space, statType, textStyle, touch, type } from '@/theme/tokens';

export function SosButton({ variant = 'fab' }: { variant?: 'fab' | 'pill' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isElder = useAuthStore((s) => s.role) === 'elder';

  const fire = async () => {
    setBusy(true);
    setError(null);
    // The SOS goes out first, never waiting for GPS.
    const { data, error: err } = await supabase.rpc('raise_sos', {});
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    // Then, in the background, add where the elder is right now (only the
    // elder's own SOS; the server refuses anyone else's).
    const alertId = (data as { id?: string } | null)?.id;
    if (alertId && isElder) {
      void currentPosition().then((pos) => {
        if (!pos) return;
        void supabase.rpc('add_sos_location', {
          p_alert_id: alertId,
          p_lat: pos.lat,
          p_lon: pos.lon,
          p_accuracy_m: pos.accuracy_m,
        });
      });
    }
    setDone(true);
    // auto-close after a short confirmation
    setTimeout(() => {
      setOpen(false);
      setDone(false);
    }, 2500);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          variant === 'pill' ? styles.pill : styles.fab,
          pressed && { transform: [{ scale: 0.96 }], opacity: 0.92 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Emergency SOS"
      >
        {variant === 'pill' ? (
          <>
            <AlarmClockPlusIcon size={16} color={colors.textInverse} />
            <Text style={styles.pillLabel}>SOS</Text>
          </>
        ) : (
          <Text style={styles.fabLabel}>SOS</Text>
        )}
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => !busy && !done && setOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            {!done ? (
              <>
                <Text style={styles.title}>Send an emergency alert?</Text>
                <Text style={styles.body}>
                  Everyone in the care circle will be notified immediately.
                </Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <View style={styles.row}>
                  <Pressable
                    onPress={() => !busy && setOpen(false)}
                    style={[styles.action, styles.cancel]}
                  >
                    <Text style={styles.cancelLabel}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={fire} disabled={busy} style={[styles.action, styles.confirm]}>
                    {busy ? (
                      <ActivityIndicator color={colors.textInverse} />
                    ) : (
                      <Text style={styles.confirmLabel}>Confirm emergency</Text>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.title}>Alert sent</Text>
                <Text style={styles.body}>
                  Your family has been notified. Help is on the way.
                </Text>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: space.xl,
    right: space.xl,
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.alertCritical,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.ambient,
  },
  fabLabel: { ...type.title, color: colors.textInverse, fontWeight: '900' },
  // Figma "Emergency SOS": #ef4444, fully rounded, 10/16 padding, gap 6, alarm-clock-plus 16, Inter 800 14/17.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.alertCritical,
  },
  pillLabel: { ...textStyle(statType.sos), color: colors.textInverse },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.xl,
    gap: space.l,
  },
  title: { ...type.title, color: colors.textPrimary, textAlign: 'left' },
  body: { ...type.bodyLarge, color: colors.textSecondary, textAlign: 'left' },
  row: { flexDirection: 'row', gap: space.m, marginTop: space.m },
  action: {
    flex: 1,
    minHeight: touch.elderMin,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: { backgroundColor: colors.surfaceMuted },
  cancelLabel: { ...type.subtitle, color: colors.textPrimary },
  confirm: { backgroundColor: colors.alertCritical },
  confirmLabel: { ...type.subtitle, color: colors.textInverse },
  error: { ...type.body, color: colors.alertCritical, textAlign: 'left' },
});
