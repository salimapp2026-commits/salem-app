// Invite redeem screen. Any signed-in user pastes the token from a care-circle
// invite and joins that elder's circle. Routes back through the role router
// after success so the auth store re-bootstraps the role bucket.
//
// We deliberately accept the raw bearer token (URL-safe hex) rather than
// generating a short numeric code — keeps the UX honest about what the
// security model is (anyone with the token can redeem until expiry).
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from '@/navigation/router';
import { FieldScreen, SubHeader } from '@/components/dashboard';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, touch, type } from '@/theme/tokens';

type RedeemResult = {
  r_circle_id: string;
  r_elder_id: string;
  r_elder_name: string | null;
  r_member_role: 'primary_caretaker' | 'family' | 'doctor';
};

export default function RedeemInvite() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(params.token ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Enter the code.');
      return;
    }
    // A short all-digits value is a family code: the "Be invited" screen handles it
    // (step32b). Anything longer is a raw invite token from a link/email.
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 4 && digits === trimmed) {
      router.replace({ pathname: '/link/join', params: { code: digits } });
      return;
    }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('redeem_circle_invite', { p_token: trimmed });
    setBusy(false);
    if (err) {
      setError(translateRedeemError(err.message));
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as RedeemResult | null;
    Alert.alert(
      'Connected',
      row?.r_elder_name
        ? `You joined ${row.r_elder_name}’s care circle.`
        : 'You joined the care circle.',
    );
    router.replace('/');
  };

  return (
    <FieldScreen>
      <SubHeader title="Pair with a senior" />
      <ScrollView contentContainerStyle={styles.scrollBody}>

      <KeyboardAvoidingView
        style={{ gap: space.l }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Card>
          <Text style={styles.body}>
            Enter the four-digit code shown on your family member’s screen, or
            paste an invite code you received.
          </Text>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Pairing or invite code</Text>
            <TextInput
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="____"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              textAlign="left"
            />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Connect" onPress={submit} loading={busy} />
        </Card>
      </KeyboardAvoidingView>
      </ScrollView>
    </FieldScreen>
  );
}

function translateRedeemError(msg: string): string {
  if (msg.includes('invite_not_found')) return 'That code is not valid.';
  if (msg.includes('invite_already_redeemed')) return 'That invite has already been used.';
  if (msg.includes('invite_expired')) return 'That invite has expired.';
  if (msg.includes('not_authenticated')) return 'Sign in first.';
  if (msg.includes('invalid_or_expired_code'))
    return 'That code is wrong or expired. Ask for a new one.';
  if (msg.includes('too_many_attempts'))
    return 'Too many attempts. Wait 15 minutes and try again.';
  return msg;
}

const styles = StyleSheet.create({
  scrollBody: { paddingHorizontal: space.m, paddingBottom: space.xxl },
  body: { ...type.body, color: colors.textPrimary, textAlign: 'left', marginBottom: space.m },
  field: { gap: space.s, marginBottom: space.m },
  fieldLabel: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  input: {
    minHeight: touch.elderMin,
    backgroundColor: colors.cream,
    borderRadius: radius.xl,
    paddingHorizontal: space.l,
    ...type.body,
    color: colors.textPrimary,
  },
  error: { ...type.body, color: colors.alertCritical, textAlign: 'left' },
});
