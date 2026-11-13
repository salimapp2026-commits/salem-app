// Create-account screen, laid out to match the Salem visual identity exactly:
// full name, phone number, email — no password. Submitting emails a magic link
// (Supabase signInWithOtp with shouldCreateUser); the display name and phone
// ride along in user metadata so handle_new_user can seed the profile when the
// link is opened and /auth-callback attaches the session.
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from '@/navigation/router';
import {
  AuthButton,
  AuthField,
  AuthLink,
  AuthScreen,
  AuthSmile,
} from '@/components/AuthShell';
import { authErrorKey, normalizePhone, signUpPasswordless } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { type } from '@/theme/tokens';

// One field accepts either form, so we route on content: anything containing
// "@" is treated as an email (magic link), anything else as a phone number
// (SMS OTP, continued on the phone screen).
function looksLikeEmail(value: string): boolean {
  return value.includes('@');
}

export default function SignUp() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const value = contact.trim();
    try {
      if (looksLikeEmail(value)) {
        await signUpPasswordless({
          email: value,
          displayName: name.trim(),
        });
        setSent(true);
      } else {
        // Phone path — hand off to the OTP screen with the number prefilled.
        const e164 = normalizePhone(value, '+20');
        router.push({
          pathname: '/(auth)/phone-sign-in',
          params: { phone: e164, name: name.trim() },
        });
      }
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthScreen>
        <View style={styles.center}>
          <Text style={styles.sentTitle}>check your email</Text>
          <Text style={styles.sentBody}>
            we sent a sign-in link to {contact.trim()}. open it to finish
            creating your account.
          </Text>
          <View style={styles.sentCta}>
            <AuthButton
              label="back to sign in"
              onPress={() => router.replace('/(auth)/sign-in')}
            />
          </View>
          <AuthSmile />
        </View>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <AuthField
        icon="person"
        label="full name"
        placeholder="enter your full name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />
      <AuthField
        icon="mail"
        label="email or phone number"
        placeholder="enter your email or phone number"
        value={contact}
        onChangeText={setContact}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <AuthButton
        label="create account"
        onPress={submit}
        loading={busy}
        disabled={!name.trim() || !contact.trim()}
      />

      <AuthSmile />

      <View style={styles.spacer} />
      <AuthLink
        label="already have an account? sign in"
        onPress={() => router.replace('/(auth)/sign-in')}
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
  spacer: { flex: 1, minHeight: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  sentTitle: { ...type.title, color: '#ffffff' },
  sentBody: {
    ...type.bodyLarge,
    color: '#ffffff',
    textAlign: 'center',
    opacity: 0.92,
  },
  sentCta: { alignSelf: 'stretch', marginTop: 8, marginBottom: 8 },
});
