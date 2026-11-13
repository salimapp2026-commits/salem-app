// Sign-in screen, styled to match the Salem visual identity (indigo field,
// filled icon badges, white pill inputs, white pill CTA, smile beneath).
// Email + password remains the primary path; passwordless accounts created on
// the sign-up screen arrive via the emailed magic link instead.
import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { useRouter } from '@/navigation/router';
import {
  AuthButton,
  AuthField,
  AuthLink,
  AuthScreen,
  AuthSmile,
} from '@/components/AuthShell';
import { supabase } from '@/lib/supabase';
import { authErrorKey, resetPasswordForEmail } from '@/lib/auth';
import { type } from '@/theme/tokens';
import { t } from '@/lib/i18n';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (err) {
      setError(t(authErrorKey(err)));
      return;
    }
    router.replace('/');
  };

  const onForgotPassword = async () => {
    const target = email.trim();
    if (!target) {
      setError(t('auth.enterEmailFirst'));
      return;
    }
    try {
      await resetPasswordForEmail(target);
      Alert.alert(
        t('auth.resetSentTitle'),
        t('auth.resetSentBody').replace('{email}', target),
      );
    } catch (e) {
      setError(t(authErrorKey(e)));
    }
  };

  return (
    <AuthScreen>
      <AuthField
        icon="mail"
        label="email or phone number"
        placeholder="enter your email or phone number"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <AuthField
        icon="lock-closed"
        label="password"
        placeholder="enter your password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <AuthButton
        label="sign in"
        onPress={submit}
        loading={busy}
        disabled={!email || !password}
      />

      <AuthSmile />

      <AuthLink label="forgot password?" onPress={onForgotPassword} />
      <AuthLink
        label="sign in with phone number"
        onPress={() => router.push('/(auth)/phone-sign-in')}
      />
      <AuthLink
        label="create account"
        onPress={() => router.push('/(auth)/sign-up')}
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  error: {
    ...type.body,
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 12,
  },
});
