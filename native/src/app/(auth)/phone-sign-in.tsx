// Phone OTP sign-in / sign-up. Single screen, three stages:
//   stage 'request'  — enter phone, request OTP
//   stage 'verify'   — enter 6-digit code, verify
//   stage 'name'     — first-time signup; ask for display name, upsert profile
//
// We use a state machine instead of three routes so the back button keeps the
// user inside the auth stack and we don't lose the entered phone if they go
// back from the OTP step.
//
// The Supabase Phone provider must be configured in the dashboard. Without
// that, requestPhoneOtp throws and we surface the friendly error.
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useRouter } from '@/navigation/router';
import { getLocales } from 'react-native-localize';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import {
  CountryCodePicker,
  COUNTRIES,
  type Country,
} from '@/components/CountryCodePicker';
import {
  authErrorKey,
  ensureProfile,
  normalizePhone,
  requestPhoneOtp,
  verifyPhoneOtp,
} from '@/lib/auth';
import { t } from '@/lib/i18n';
import { colors, radius, space, touch, type } from '@/theme/tokens';

// Pick the device's default country based on locale region (e.g. "en-EG" → EG).
// Falls back to Egypt because the team works there; if that ISO isn't in our
// curated list, fall back to the first entry.
function defaultCountry(): Country {
  const region = getLocales()[0]?.countryCode?.toUpperCase();
  const match = region ? COUNTRIES.find((c) => c.iso === region) : undefined;
  return match ?? COUNTRIES.find((c) => c.iso === 'EG') ?? COUNTRIES[0];
}

type Stage = 'request' | 'verify' | 'name';

const RESEND_SECONDS = 60;

export default function PhoneSignIn() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('request');
  const [country, setCountry] = useState<Country>(defaultCountry);
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneE164, setPhoneE164] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const startResendTimer = () => {
    setResendIn(RESEND_SECONDS);
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) {
          if (tickRef.current) clearInterval(tickRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const sendOtp = async () => {
    setError(null);
    const normalized = normalizePhone(phoneRaw.trim(), country.code);
    if (!/^\+\d{8,15}$/.test(normalized)) {
      setError(t('auth.phone.invalidNumber'));
      return;
    }
    setBusy(true);
    try {
      await requestPhoneOtp(normalized);
      setPhoneE164(normalized);
      setStage('verify');
      startResendTimer();
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    if (!/^\d{4,8}$/.test(code.trim())) {
      setError(t('auth.phone.invalidCode'));
      return;
    }
    setBusy(true);
    try {
      const res = await verifyPhoneOtp(phoneE164, code.trim());
      setUserId(res.user.id);
      if (res.isFirstSignIn) {
        setStage('name');
      } else {
        router.replace('/');
      }
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    setError(null);
    if (!name.trim()) {
      setError(t('settings.nameRequired'));
      return;
    }
    if (!userId) {
      setError(t('auth.error.unknown'));
      return;
    }
    setBusy(true);
    try {
      await ensureProfile({
        userId,
        displayName: name.trim(),
        phoneE164,
      });
      router.replace('/');
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <View style={styles.brandRow}>
        <Text style={styles.brand}>salem</Text>
        <Text style={styles.tagline}>
          {stage === 'request'
            ? t('auth.phone.requestSubtitle')
            : stage === 'verify'
            ? t('auth.phone.verifySubtitle')
            : t('auth.phone.nameSubtitle')}
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ gap: space.l }}
      >
        {stage === 'request' && (
          <Card>
            <Text style={styles.fieldLabel}>{t('auth.phone.phoneLabel')}</Text>
            <View style={styles.phoneRow}>
              <View style={styles.pickerWrap}>
                <CountryCodePicker value={country} onChange={setCountry} />
              </View>
              <TextInput
                value={phoneRaw}
                onChangeText={setPhoneRaw}
                keyboardType="phone-pad"
                autoComplete="tel"
                placeholder="5xx xxx xxx"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, styles.phoneInput]}
                textAlign="left"
              />
            </View>
            <Text style={styles.hint}>{t('auth.phone.formatHint')}</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              label={t('auth.phone.requestCta')}
              onPress={sendOtp}
              loading={busy}
              disabled={!phoneRaw.trim()}
            />
          </Card>
        )}

        {stage === 'verify' && (
          <Card>
            <Text style={styles.body}>
              {t('auth.phone.verifyBody').replace('{phone}', phoneE164)}
            </Text>
            <Field
              label={t('auth.phone.codeLabel')}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={8}
              autoComplete="sms-otp"
              autoFocus
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              label={t('auth.phone.verifyCta')}
              onPress={verify}
              loading={busy}
              disabled={code.length < 4}
            />
            <Pressable
              onPress={resendIn > 0 ? undefined : sendOtp}
              hitSlop={8}
              style={[styles.link, resendIn > 0 && { opacity: 0.5 }]}
            >
              <Text style={styles.linkText}>
                {resendIn > 0
                  ? t('auth.phone.resendIn').replace('{n}', String(resendIn))
                  : t('auth.phone.resend')}
              </Text>
            </Pressable>
            <Pressable onPress={() => setStage('request')} hitSlop={8} style={styles.link}>
              <Text style={styles.linkText}>{t('auth.phone.changeNumber')}</Text>
            </Pressable>
          </Card>
        )}

        {stage === 'name' && (
          <Card>
            <Text style={styles.body}>{t('auth.phone.nameBody')}</Text>
            <Field
              label={t('settings.displayName')}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoFocus
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              label={t('common.continue')}
              onPress={saveName}
              loading={busy}
              disabled={!name.trim()}
            />
          </Card>
        )}

        <View style={styles.footer}>
          <Link href="/(auth)/sign-in" replace style={styles.link}>
            <Text style={styles.linkText}>{t('auth.phone.backToEmail')}</Text>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field(
  props: React.ComponentProps<typeof TextInput> & { label: string },
) {
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
  brandRow: { alignItems: 'center', gap: space.s, marginTop: space.xxl, marginBottom: space.xl },
  brand: { ...type.display, color: colors.primary },
  tagline: { ...type.subtitle, color: colors.textSecondary, textAlign: 'center' },
  body: { ...type.body, color: colors.textPrimary, textAlign: 'left', marginBottom: space.m },
  hint: { ...type.caption, color: colors.textSecondary, textAlign: 'left', marginBottom: space.m },
  field: { gap: space.s, marginBottom: space.m },
  fieldLabel: { ...type.caption, color: colors.textSecondary, textAlign: 'left', marginBottom: space.s },
  input: {
    minHeight: touch.elderMin,
    backgroundColor: colors.cream,
    borderRadius: radius.xl,
    paddingHorizontal: space.l,
    ...type.body,
    color: colors.textPrimary,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: space.s,
    marginBottom: space.s,
  },
  pickerWrap: { flexBasis: 120, flexGrow: 0 },
  phoneInput: { flex: 1 },
  error: { ...type.body, color: colors.alertCritical, textAlign: 'left', marginBottom: space.m },
  footer: { alignItems: 'center', marginTop: space.l },
  link: { alignSelf: 'center', paddingVertical: space.m },
  linkText: { ...type.body, color: colors.primary },
});
