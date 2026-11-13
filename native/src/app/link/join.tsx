// "Be invited by a family member" — Figma "QR link" (52:1860) without the camera: the
// person types the 4-digit code they received (founder: no camera, no scanning), sees
// who they are joining (peek_link_code), and confirms (redeem_link_code, step32b). For
// every role: a caregiver or doctor joins the elder's circle; an elder whose child sent
// a "parent" code lets that child into their own circle. Wrong codes count on the
// server (5 per 15 minutes).
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from '@/navigation/router';
import { CodeBlocks, LinkShell, T, WhiteButton, linkStyles } from '@/components/linkParts';
import { supabase } from '@/lib/supabase';
import { cleanCode, type JoinsAs, statusKey } from '@/lib/linkCode';
import { t, tf } from '@/lib/i18n';
import { colors, textStyle } from '@/theme/tokens';

type Peek = { status: string; elder_name: string | null; inviter_name: string | null; joins_as: JoinsAs | null };
type Redeem = { status: string; elder_name: string | null };

export default function BeInvited() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(cleanCode(params.code ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const input = useRef<TextInput>(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('peek_link_code', { p_code: code });
    setBusy(false);
    const row = (Array.isArray(data) ? data[0] : data) as Peek | null;
    if (err || !row) return setError(t('link.err.generic'));
    if (row.status !== 'ok') return setError(t(statusKey(row.status)));
    setPeek(row);
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('redeem_link_code', { p_code: code });
    setBusy(false);
    const row = (Array.isArray(data) ? data[0] : data) as Redeem | null;
    if (err || !row) return setError(t('link.err.generic'));
    if (row.status !== 'ok') {
      setPeek(null);
      return setError(t(statusKey(row.status)));
    }
    void qc.invalidateQueries();
    setJoined(peek?.joins_as === 'parent'
      ? tf('link.joinedParent', { inviter: peek.inviter_name ?? '' })
      : tf('link.joined', { elder: row.elder_name ?? peek?.elder_name ?? '' }));
  };

  if (joined) {
    return (
      <LinkShell title={t('link.joinTitle')} headline={joined}>
        <View style={linkStyles.actions}>
          <WhiteButton label={t('link.done')} onPress={() => router.replace('/')} />
        </View>
      </LinkShell>
    );
  }

  if (peek) {
    const question = peek.joins_as === 'parent'
      ? tf('link.confirmParent', { inviter: peek.inviter_name ?? '' })
      : tf(peek.joins_as === 'doctor' ? 'link.confirmDoctor' : 'link.confirmCaregiver', { elder: peek.elder_name ?? '' });
    return (
      <LinkShell title={t('link.joinTitle')} headline={question}
        sub={peek.joins_as !== 'parent' && peek.inviter_name && peek.inviter_name !== peek.elder_name
          ? tf('link.invitedBy', { name: peek.inviter_name }) : undefined}>
        <View style={linkStyles.actions}>
          <WhiteButton label={t(peek.joins_as === 'parent' ? 'link.agree' : 'link.join')} onPress={join} disabled={busy} />
          <WhiteButton label={t('link.cancel')} tone="outline" onPress={() => { setPeek(null); setCode(''); }} disabled={busy} />
        </View>
        {error ? <Text style={linkStyles.error}>{error}</Text> : null}
      </LinkShell>
    );
  }

  return (
    <LinkShell title={t('link.joinTitle')} headline={t('link.typeHead')} sub={t('link.typeSub')}>
      <Pressable onPress={() => input.current?.focus()} accessibilityRole="none">
        <CodeBlocks code={code} active={code.length < 4 ? code.length : undefined} />
        {/* The real field, invisible over the four blocks. */}
        <TextInput
          ref={input}
          value={code}
          onChangeText={(v) => { setCode(cleanCode(v)); setError(null); }}
          keyboardType="number-pad"
          maxLength={4}
          autoFocus
          style={styles.hidden}
          caretHidden
          importantForAutofill="no"
          accessibilityLabel={t('link.typeHead')}
        />
      </Pressable>
      {error ? <Text style={linkStyles.error}>{error}</Text> : null}
      <View style={linkStyles.actions}>
        <WhiteButton label={t('link.continue')} onPress={check} disabled={code.length !== 4 || busy} />
      </View>
    </LinkShell>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', top: 40, left: 32, right: 32, bottom: 0, opacity: 0, color: colors.surface, ...textStyle(T.body) },
});
