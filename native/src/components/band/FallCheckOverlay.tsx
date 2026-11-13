// "Are you OK?" — shown to the ELDER on any screen when the band reported a
// fall that is still waiting for an answer (band_events.status = 'pending').
//
// Today the fall comes from the server (the band → phone → band-ingest path, or
// scripts/band/simulate.ts), so this works on web. In the phone app the BLE
// layer will also open it the instant the band reports the fall (see
// docs/MOBILE_MIGRATION.md §4.7); the server deadline stays the source of truth.
//
//   I'm OK    → cancel_band_fall()  → no alert
//   Get help  → confirm_band_fall() → critical alert now
//   no answer → the server's 30-second job alerts the family
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useBandStatus } from '@/lib/band';
import { useAuthStore } from '@/stores/authStore';
import { t, tf } from '@/lib/i18n';
import { colors, radius, space, touch, type } from '@/theme/tokens';

type Phase =
  | { kind: 'idle' }
  | { kind: 'ask'; eventId: string }
  | { kind: 'busy'; eventId: string }
  | { kind: 'done'; message: string };

export function FallCheckOverlay() {
  const userId = useAuthStore((s) => s.user?.id);
  const role = useAuthStore((s) => s.role);
  const isElder = !!userId && role === 'elder';
  return isElder ? <FallCheck elderId={userId} /> : null;
}

function FallCheck({ elderId }: { elderId: string }) {
  const qc = useQueryClient();
  // Every 5 s while a band is paired; once a minute otherwise (to notice pairing).
  const status = useBandStatus(elderId, { refetchMs: (last) => (last?.paired ? 5_000 : 60_000) });
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [left, setLeft] = useState(30);
  const handled = useRef<Set<string>>(new Set());

  const s = status.data;
  const pending = s && s.paired ? s.pending_fall : null;
  // Server clock vs this device: the countdown follows the server's deadline.
  const skewMs = s && s.paired ? new Date(s.server_time).getTime() - status.dataUpdatedAt : 0;

  // A new pending fall opens the screen; one that disappears while we were
  // asking means the server already told the family.
  useEffect(() => {
    if (pending && !handled.current.has(pending.id) && phase.kind === 'idle') {
      setPhase({ kind: 'ask', eventId: pending.id });
    }
    if (!pending && phase.kind === 'ask') {
      handled.current.add(phase.eventId);
      setPhase({ kind: 'done', message: t('fall.sent') });
    }
  }, [pending, phase]);

  useEffect(() => {
    if (phase.kind !== 'ask' || !pending) return;
    const tick = () => {
      const ms = new Date(pending.respond_by).getTime() - (Date.now() + skewMs);
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase.kind, pending, skewMs]);

  async function answer(ok: boolean) {
    if (phase.kind !== 'ask') return;
    const eventId = phase.eventId;
    setPhase({ kind: 'busy', eventId });
    handled.current.add(eventId);
    const { data, error } = await supabase.rpc(ok ? 'cancel_band_fall' : 'confirm_band_fall', {
      p_event_id: eventId,
    });
    void qc.invalidateQueries({ queryKey: ['band_status', elderId] });
    if (error) {
      // Never leave the elder on a dead screen: if the call failed, the
      // server deadline still alerts the family.
      setPhase({ kind: 'done', message: t('fall.sent') });
      return;
    }
    if (ok) setPhase({ kind: 'done', message: data === 'cancelled' ? t('fall.cancelled') : t('fall.alreadySent') });
    else setPhase({ kind: 'done', message: t('fall.sent') });
  }

  return (
    <Modal visible={phase.kind !== 'idle'} animationType="fade" transparent={false} onRequestClose={() => undefined}>
      {phase.kind === 'idle' ? null : (
        <FallCheckView
          state={phase.kind === 'done' ? { kind: 'done', message: phase.message } : { kind: phase.kind, left }}
          onOk={() => answer(true)}
          onHelp={() => answer(false)}
          onClose={() => setPhase({ kind: 'idle' })}
        />
      )}
    </Modal>
  );
}

export type FallCheckState =
  | { kind: 'ask' | 'busy'; left: number }
  | { kind: 'done'; message: string };

/** The screen itself, without the Modal (also used by app/dev/band-preview). */
export function FallCheckView({
  state,
  onOk,
  onHelp,
  onClose,
}: {
  state: FallCheckState;
  onOk: () => void;
  onHelp: () => void;
  onClose: () => void;
}) {
  if (state.kind === 'done') {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>{state.message}</Text>
        <Pressable
          style={({ pressed }) => [styles.btn, styles.close, pressed && styles.pressed]}
          onPress={onClose}
          accessibilityRole="button"
        >
          <Text style={[styles.btnText, { color: colors.primary }]}>{t('fall.close')}</Text>
        </Pressable>
      </View>
    );
  }
  const busy = state.kind === 'busy';
  return (
    <View style={styles.screen} accessibilityViewIsModal>
      <View style={styles.iconWrap}>
        <Feather name="alert-triangle" size={48} color={colors.textInverse} />
      </View>
      <Text style={styles.title} accessibilityRole="header">{t('fall.title')}</Text>
      <Text style={styles.body}>{t('fall.body')}</Text>
      <Text style={styles.countdown} accessibilityLiveRegion="polite">
        {state.left > 0 ? tf('fall.countdown', { n: state.left }) : t('fall.telling')}
      </Text>
      <Pressable
        style={({ pressed }) => [styles.btn, styles.ok, pressed && styles.pressed]}
        onPress={onOk}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('fall.ok')}
      >
        <Feather name="check-circle" size={28} color={colors.textInverse} />
        <Text style={styles.btnText}>{t('fall.ok')}</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.btn, styles.help, pressed && styles.pressed]}
        onPress={onHelp}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('fall.help')}
      >
        <Feather name="phone-call" size={28} color={colors.textInverse} />
        <Text style={styles.btnText}>{t('fall.help')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.l,
    gap: space.m,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...type.display, fontSize: 34, lineHeight: 42, color: colors.textInverse, textAlign: 'center' },
  body: { ...type.bodyLarge, fontSize: 20, lineHeight: 28, color: colors.onPrimary, textAlign: 'center' },
  countdown: { ...type.subtitle, fontSize: 18, color: colors.onPrimaryMuted, textAlign: 'center', marginBottom: space.m },
  btn: {
    alignSelf: 'center',
    maxWidth: 420,
    width: '100%',
    minHeight: touch.elderMin + 16,
    borderRadius: radius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.m,
  },
  ok: { backgroundColor: colors.success },
  help: { backgroundColor: colors.alertCritical },
  close: { backgroundColor: colors.surface },
  pressed: { opacity: 0.85 },
  btnText: { ...type.title, fontSize: 24, lineHeight: 30, color: colors.textInverse },
});
