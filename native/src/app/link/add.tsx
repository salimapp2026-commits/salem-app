// "Add a family member" — Figma "Accounts link" (52:2298), for every role that may add
// (founder, 2026-11-01). The elder or a primary caretaker chooses what the new member is
// (caregiver or doctor); any other caregiver can bring in their own parent (L2) — only
// the elder and the primary caretaker add members to a circle. The app
// makes a one-time 4-digit code (create_link_code, step32b) and shows it with a Share
// button (WhatsApp etc.). Single use, 15 minutes; the screen waits for it to be used.
// Doctors can't add anyone (L1). No camera, no scanning.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/navigation/router';
import { CodeBlocks, HelpTip, LinkShell, T, WhiteButton, linkStyles } from '@/components/linkParts';
import { supabase } from '@/lib/supabase';
import { addChoices, type JoinsAs, remaining, shareText } from '@/lib/linkCode';
import { getLocale, t, tf } from '@/lib/i18n';
import { bucketForRole, useAuthStore } from '@/stores/authStore';
import { colors, textStyle } from '@/theme/tokens';

type Circle = { circle_id: string; elder_id: string; elder_name: string | null; is_elder: boolean };
type Made = { code: string; expires_at: string; invite_id: string; joins_as: JoinsAs };

export default function AddFamilyMember() {
  const router = useRouter();
  const qc = useQueryClient();
  const bucket = useAuthStore((s) => bucketForRole(s.role)) ?? 'family';
  const lang = getLocale() === 'ar' ? 'ar' : 'en';

  const circles = useQuery<Circle[]>({
    queryKey: ['my_circles'],
    enabled: bucket === 'family',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_circles');
      if (error) throw error;
      return (data ?? []) as Circle[];
    },
  });
  // The elders whose circle I may add to: where I am the primary caretaker.
  const userId = useAuthStore((s) => s.user?.id);
  const primaryOf = useQuery<string[]>({
    queryKey: ['primary_of', userId],
    enabled: bucket === 'family' && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('care_circle_members')
        .select('care_circles!inner(elder_id)')
        .eq('user_id', userId!).eq('status', 'active').eq('member_role', 'primary_caretaker').eq('can_manage_circle', true);
      if (error) throw error;
      return ((data ?? []) as unknown as { care_circles: { elder_id: string } }[]).map((r) => r.care_circles.elder_id);
    },
  });
  const elders = useMemo(
    () => (circles.data ?? []).filter((c) => !c.is_elder && (primaryOf.data ?? []).includes(c.elder_id)),
    [circles.data, primaryOf.data],
  );
  const [elderId, setElderId] = useState<string | undefined>();
  const forElder = elderId ?? elders[0]?.elder_id;
  const ready = bucket !== 'family' || (circles.isFetched && primaryOf.isFetched);
  const choices = addChoices(bucket, elders.length > 0);
  // A family member of someone's circle (not its primary caretaker) is told why.
  const notPrimary = bucket === 'family' && ready && elders.length === 0 && (circles.data ?? []).some((c) => !c.is_elder);

  const make = useMutation({
    mutationFn: async (role: JoinsAs): Promise<Made> => {
      const { data, error } = await supabase.rpc('create_link_code', {
        p_role: role,
        p_elder_id: role === 'parent' || bucket === 'elder' ? null : forElder ?? null,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as Made;
    },
  });
  const made = make.data;

  // The countdown, and waiting for the code to be used.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!made) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [made]);
  const left = remaining(made?.expires_at, now);
  const accepted = useQuery({
    queryKey: ['link_code_accepted', made?.invite_id],
    enabled: !!made && !!left,
    refetchInterval: (q) => (q.state.data ? false : 3000),
    queryFn: async () => {
      const { data } = await supabase.rpc('link_code_accepted', { p_invite_id: made!.invite_id });
      return data === true;
    },
  });
  const connected = accepted.data === true;
  useEffect(() => {
    if (connected) void qc.invalidateQueries();
  }, [connected, qc]);

  const share = () => made && Share.share({ message: shareText(made.code, lang) });

  if (bucket === 'doctor') {
    return <LinkShell title={t('link.addTitle')} headline={t('link.noAdd')}>{null}</LinkShell>;
  }

  if (!made) {
    return (
      <LinkShell title={t('link.addTitle')} headline={t('link.whoTitle')}>
        {elders.length > 1 ? (
          <View style={styles.elders}>
            {elders.map((e) => (
              <Pressable key={e.elder_id} onPress={() => setElderId(e.elder_id)} accessibilityRole="button"
                style={[styles.elderChip, forElder === e.elder_id && styles.elderChipOn]}>
                <Text style={[styles.elderText, forElder === e.elder_id && { color: colors.primary }]}>{e.elder_name ?? '—'}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.choices}>
          {ready ? choices.map((c) => (
            <Pressable key={c} onPress={() => make.mutate(c)} disabled={make.isPending} accessibilityRole="button"
              style={({ pressed }) => [styles.choice, (pressed || make.isPending) && { opacity: 0.85 }]}>
              <Text style={styles.choiceTitle}>{t(`link.role.${c}`)}</Text>
              <Text style={styles.choiceSub}>{t(`link.role.${c}Sub`)}</Text>
            </Pressable>
          )) : <Text style={linkStyles.status}>{t('common.loading')}</Text>}
        </View>
        {notPrimary ? <Text style={[linkStyles.status, styles.note]}>{t('link.onlyPrimary')}</Text> : null}
        {make.isError ? <Text style={linkStyles.error}>{t('link.err.generic')}</Text> : null}
      </LinkShell>
    );
  }

  if (connected) {
    return (
      <LinkShell title={t('link.addTitle')} headline={t(made.joins_as === 'parent' ? 'link.connectedParent' : 'link.connected')}>
        <View style={linkStyles.actions}>
          <WhiteButton label={t('link.done')} onPress={() => router.replace('/')} />
        </View>
      </LinkShell>
    );
  }

  return (
    <LinkShell title={t('link.addTitle')} headline={t('link.shareHead')} sub={t(`link.shareSub.${made.joins_as}`)}>
      <CodeBlocks code={left ? made.code : ''} />
      <HelpTip text={t('link.keepOpen')} />
      <View style={styles.status}>
        {left ? (
          <View style={styles.waitRow}>
            <View style={styles.dot} />
            <Text style={linkStyles.status}>{tf('link.waiting', { time: left })}</Text>
          </View>
        ) : <Text style={linkStyles.status}>{t('link.expired')}</Text>}
      </View>
      <View style={linkStyles.actions}>
        {left ? <WhiteButton label={t('link.share')} onPress={share} /> : null}
        <WhiteButton label={t('link.newCode')} tone="outline" onPress={() => make.mutate(made.joins_as)} disabled={make.isPending} />
      </View>
    </LinkShell>
  );
}

const styles = StyleSheet.create({
  elders: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 24, marginHorizontal: 32 },
  elderChip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 2, borderColor: colors.surface, justifyContent: 'center' },
  elderChipOn: { backgroundColor: colors.surface },
  elderText: { ...textStyle(T.button), color: colors.textInverse },
  choices: { gap: 14, marginHorizontal: 32, marginTop: 32 },
  choice: { backgroundColor: colors.surface, borderRadius: 24, paddingVertical: 20, paddingHorizontal: 22, gap: 6, minHeight: 64 },
  choiceTitle: { ...textStyle({ size: 20, line: 26, weight: 800 }), color: colors.primary },
  choiceSub: { ...textStyle(T.tip), color: '#666666' },
  status: { alignItems: 'center', marginTop: 28 },
  note: { marginHorizontal: 32, marginTop: 24 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },
});
