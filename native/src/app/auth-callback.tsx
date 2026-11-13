// Landing screen for Supabase's emails (password reset, email confirmation).
// The phone opens salem://auth-callback#… or ?code=…; App.tsx passes that URL
// here as the `url` param (lib/authLink.ts turns it into a session):
//   type=recovery → set a new password
//   confirmation  → signed in, go to the role router
//   error         → readable error
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from '@/navigation/router';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { supabase } from '@/lib/supabase';
import { authErrorKey } from '@/lib/auth';
import { handleAuthLink, isAuthLink } from '@/lib/authLink';
import { t } from '@/lib/i18n';
import { colors, radius, space, touch, type } from '@/theme/tokens';

type Phase = 'loading' | 'recovery' | 'error';

export default function AuthCallback() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);

  const { url: urlParam } = useLocalSearchParams<{ url?: string }>();

  useEffect(() => {
    let alive = true;
    (async () => {
      const url = urlParam ?? (await Linking.getInitialURL());
      if (!alive) return;
      if (!url || !isAuthLink(url)) {
        router.replace('/');
        return;
      }
      const r = await handleAuthLink(url);
      if (!alive) return;
      if (r.kind === 'recovery') setPhase('recovery');
      else if (r.kind === 'error') {
        setError(r.message);
        setPhase('error');
      } else router.replace('/');
    })();
    return () => {
      alive = false;
    };
  }, [urlParam, router]);

  if (phase === 'loading') {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.body}>{t('common.loading')}</Text>
        </View>
      </Screen>
    );
  }

  if (phase === 'error') {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.title}>{t('auth.callback.errorTitle')}</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Button
            label={t('auth.callback.goSignIn')}
            onPress={() => router.replace('/(auth)/sign-in')}
          />
        </View>
      </Screen>
    );
  }

  return <ResetPasswordForm />;
}

function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (password.length < 8) {
      setError(t('auth.callback.passwordTooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.callback.passwordMismatch'));
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(t(authErrorKey(err)));
      return;
    }
    Alert.alert(t('auth.callback.passwordUpdated'));
    router.replace('/');
  };

  return (
    <Screen>
      <View style={styles.form}>
        <Text style={styles.title}>{t('auth.callback.resetTitle')}</Text>
        <Text style={styles.body}>{t('auth.callback.resetBody')}</Text>

        <Field
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <Field
          label={t('auth.callback.confirmPassword')}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
        />

        {error ? <Text style={styles.errorBody}>{error}</Text> : null}

        <Button
          label={t('auth.callback.savePassword')}
          onPress={submit}
          loading={busy}
          disabled={!password || !confirm}
        />
      </View>
    </Screen>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        style={styles.input}
        placeholderTextColor={colors.textSecondary}
        textAlign="left"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m },
  form: { gap: space.l, marginTop: space.xl },
  field: { gap: space.s },
  fieldLabel: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  input: {
    minHeight: touch.elderMin,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: space.l,
    ...type.body,
    color: colors.textPrimary,
  },
  title: { ...type.title, color: colors.textPrimary, textAlign: 'left' },
  body: { ...type.body, color: colors.textSecondary, textAlign: 'left' },
  errorBody: { ...type.body, color: colors.alertCritical, textAlign: 'left' },
});
