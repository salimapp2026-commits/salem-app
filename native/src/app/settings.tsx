// Account settings — shared across roles. Lets the user:
//   • Update their display name (RLS-allowed self-update on profiles)
//   • Toggle locale (ar/en) with RTL flip on next reload
//   • Adjust accessibility prefs (text scale, voice-first, high contrast)
//   • Change password (re-verifies current password before applying new one)
//   • Sign out
//
// Backend-wise this only uses primitives that already exist:
//   • supabase.from('profiles').update / select on auth.uid()
//   • supabase.auth.signInWithPassword (used as a re-auth gate)
//   • supabase.auth.updateUser({ password })
//
// We deliberately don't re-build push-token registration here — that's owned
// by the role-select onboarding flow.
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from '@/navigation/router';
import { safeBack } from '@/lib/nav';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { pickImages, readFileBytes } from '@/lib/pickImages';
import { FieldScreen, SubHeader } from '@/components/dashboard';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { BandStatusCard } from '@/components/band/BandStatusCard';
import { HealthConnectSection, SosLocationSection } from '@/components/elder/PhoneSetupSections';
import { useBandStatus } from '@/lib/band';
import { supabase } from '@/lib/supabase';
import { moodNoticeKey, setMoodNotice, useMoodNotice } from '@/lib/moodNotice';
import { authErrorKey } from '@/lib/auth';
import { confirm } from '@/lib/confirm';
import {
  cancelAccountDeletion,
  downloadAccountData,
  fetchDeletionStatus,
  requestAccountDeletion,
  type DeletionRequest,
} from '@/lib/account';
import { bucketForRole, useAuthStore } from '@/stores/authStore';
import { LOCALE_PINNED, formatDate, getLocale, setLocale, t, type Locale } from '@/lib/i18n';
import { colors, radius, space, touch, type } from '@/theme/tokens';

type A11yPrefs = {
  text_scale?: number;
  voice_first?: boolean;
  high_contrast?: boolean;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  preferred_locale: string | null;
  a11y_prefs: A11yPrefs | null;
  avatar_url: string | null;
  trend_line_enabled: boolean;
};

export default function Settings() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  const userEmail = useAuthStore((s) => s.user?.email);
  const signOut = useAuthStore((s) => s.signOut);
  const isElder = bucketForRole(useAuthStore((s) => s.role)) === 'elder';

  const profile = useQuery({
    queryKey: ['profile-self', userId],
    enabled: !!userId,
    queryFn: async (): Promise<ProfileRow> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, preferred_locale, a11y_prefs, avatar_url, trend_line_enabled')
        .eq('id', userId!)
        .maybeSingle();
      if (error) throw error;
      return (
        (data as ProfileRow) ?? {
          id: userId!,
          display_name: null,
          preferred_locale: 'ar',
          a11y_prefs: null,
          avatar_url: null,
          trend_line_enabled: false,
        }
      );
    },
  });

  return (
    <FieldScreen>
      <SubHeader title={t('settings.title')} />
      <ScrollView contentContainerStyle={styles.scrollBody}>
        {profile.isLoading || !profile.data ? (
          <Card>
            <Text style={styles.body}>{t('common.loading')}</Text>
          </Card>
        ) : (
          <KeyboardAvoidingView
            style={{ gap: space.l }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ProfileSection profile={profile.data} email={userEmail ?? null} />
            {/* Language switching is disabled while the UI is pinned to the
                English design; see LOCALE_PINNED in lib/i18n.ts. */}
            {!LOCALE_PINNED ? (
              <LocaleSection initial={profile.data.preferred_locale ?? 'en'} />
            ) : null}
            <A11ySection initial={profile.data.a11y_prefs ?? {}} />
            {isElder ? <TrendLineSection initial={profile.data.trend_line_enabled} /> : null}
            {isElder ? <MoodNoticeSection /> : null}
            {isElder ? <SosLocationSection /> : null}
            {isElder ? <HealthConnectSection /> : null}
            {isElder ? <BandSection /> : null}
            <Button
              label="Subscription & plans"
              variant="secondary"
              onPress={() => router.push('/plans')}
            />
            <PasswordSection email={userEmail ?? null} />
            <Button
              label={t('common.signOut')}
              variant="ghostInverse"
              onPress={() =>
                confirm({
                  title: t('settings.signOutConfirmTitle'),
                  confirmLabel: t('common.signOut'),
                  cancelLabel: t('common.back'),
                  destructive: true,
                  onConfirm: signOut,
                })
              }
            />
            <DangerZone />

            <View style={styles.legalRow}>
              <Pressable onPress={() => router.push('/legal/privacy')} hitSlop={8}>
                <Text style={styles.legalLink}>Privacy Policy</Text>
              </Pressable>
              <Text style={styles.legalDot}>·</Text>
              <Pressable onPress={() => router.push('/legal/terms')} hitSlop={8}>
                <Text style={styles.legalLink}>Terms of Service</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        )}
      </ScrollView>
    </FieldScreen>
  );
}

function ProfileSection({
  profile,
  email,
}: {
  profile: ProfileRow;
  email: string | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(profile.display_name ?? '');
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setBusy(false);
      setErr(t('settings.nameRequired'));
      return;
    }
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', profile.id);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setMsg(t('settings.saved'));
  };

  const changePhoto = async () => {
    setErr(null);
    setMsg(null);
    const [asset] = await pickImages();
    if (!asset) return;

    setPhotoBusy(true);
    try {
      const ext = (asset.fileName?.split('.').pop() ?? 'jpg').toLowerCase();
      const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext)
        ? ext
        : 'jpg';
      // Path policy: split_part(name, '/', 1) must equal auth.uid().
      // Append a timestamp so the URL changes and CDN/browser caches bust.
      const path = `${profile.id}/avatar-${Date.now()}.${safeExt}`;

      const bytes = await readFileBytes(asset.uri);
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, bytes, {
          contentType: asset.mimeType ?? `image/${safeExt}`,
          upsert: true,
        });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = pub?.publicUrl;
      if (!url) throw new Error('public url missing');

      const { error: profErr } = await supabase
        .from('profiles')
        .update({ avatar_url: url })
        .eq('id', profile.id);
      if (profErr) throw profErr;

      qc.invalidateQueries({ queryKey: ['profile-self', profile.id] });
      setMsg(t('settings.saved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setErr(null);
    setMsg(null);
    setPhotoBusy(true);
    try {
      const { error: profErr } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', profile.id);
      if (profErr) throw profErr;
      qc.invalidateQueries({ queryKey: ['profile-self', profile.id] });
      setMsg(t('settings.saved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <Card>
      <View style={styles.avatarRow}>
        <Avatar
          url={profile.avatar_url}
          displayName={profile.display_name ?? email}
          size={72}
        />
        <View style={styles.avatarActions}>
          <Button
            label={profile.avatar_url ? t('settings.changePhoto') : t('settings.addPhoto')}
            variant="secondary"
            onPress={changePhoto}
            loading={photoBusy}
          />
          {profile.avatar_url ? (
            <Button
              label={t('settings.removePhoto')}
              variant="ghost"
              onPress={removePhoto}
            />
          ) : null}
        </View>
      </View>
      <Text style={styles.sectionTitle}>{t('settings.profile')}</Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{t('settings.email')}</Text>
        <Text style={styles.readonly}>{email ?? '—'}</Text>
      </View>
      <Field
        label={t('settings.displayName')}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />
      {err ? <Text style={styles.error}>{err}</Text> : null}
      {msg ? <Text style={styles.success}>{msg}</Text> : null}
      <Button label={t('common.save')} onPress={save} loading={busy} />
    </Card>
  );
}

function LocaleSection({ initial }: { initial: string }) {
  const [active, setActive] = useState<Locale>(initial.startsWith('en') ? 'en' : 'ar');
  const userId = useAuthStore((s) => s.user?.id);
  const [busy, setBusy] = useState(false);

  // Keep i18n locale in sync while the user toggles. Persisting to profile
  // happens on Save so we don't write on every tap.
  useEffect(() => {
    if (getLocale() !== active) setLocale(active);
  }, [active]);

  const save = async () => {
    if (!userId) return;
    setBusy(true);
    await supabase
      .from('profiles')
      .update({ preferred_locale: active })
      .eq('id', userId);
    setBusy(false);
    Alert.alert(t('settings.localeSavedTitle'), t('settings.localeSavedBody'));
  };

  return (
    <Card>
      <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.toggle, active === 'ar' && styles.toggleActive]}
          onPress={() => setActive('ar')}
        >
          <Text style={[styles.toggleText, active === 'ar' && styles.toggleTextActive]}>
            عربي
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggle, active === 'en' && styles.toggleActive]}
          onPress={() => setActive('en')}
        >
          <Text style={[styles.toggleText, active === 'en' && styles.toggleTextActive]}>
            English
          </Text>
        </Pressable>
      </View>
      <Button label={t('common.save')} onPress={save} loading={busy} />
    </Card>
  );
}

function A11ySection({ initial }: { initial: A11yPrefs }) {
  const userId = useAuthStore((s) => s.user?.id);
  const [textScale, setTextScale] = useState<number>(initial.text_scale ?? 1);
  const [voiceFirst, setVoiceFirst] = useState<boolean>(initial.voice_first ?? false);
  const [highContrast, setHighContrast] = useState<boolean>(initial.high_contrast ?? false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!userId) return;
    setBusy(true);
    await supabase
      .from('profiles')
      .update({
        a11y_prefs: {
          text_scale: textScale,
          voice_first: voiceFirst,
          high_contrast: highContrast,
        },
      })
      .eq('id', userId);
    setBusy(false);
    Alert.alert(t('settings.saved'));
  };

  return (
    <Card>
      <Text style={styles.sectionTitle}>{t('settings.accessibility')}</Text>

      <Text style={styles.fieldLabel}>{t('settings.textScale')}</Text>
      <View style={styles.row}>
        {[1, 1.15, 1.3, 1.5].map((v) => (
          <Pressable
            key={v}
            style={[styles.toggle, textScale === v && styles.toggleActive]}
            onPress={() => setTextScale(v)}
          >
            <Text
              style={[styles.toggleText, textScale === v && styles.toggleTextActive]}
            >
              {Math.round(v * 100)}%
            </Text>
          </Pressable>
        ))}
      </View>

      <SwitchRow
        label={t('settings.voiceFirst')}
        value={voiceFirst}
        onValueChange={setVoiceFirst}
      />
      <SwitchRow
        label={t('settings.highContrast')}
        value={highContrast}
        onValueChange={setHighContrast}
      />

      <Button label={t('common.save')} onPress={save} loading={busy} />
    </Card>
  );
}

function PasswordSection({ email }: { email: string | null }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setMsg(null);
    if (!email) {
      setErr(t('auth.error.unknown'));
      return;
    }
    if (next.length < 8) {
      setErr(t('auth.callback.passwordTooShort'));
      return;
    }
    if (next !== confirm) {
      setErr(t('auth.callback.passwordMismatch'));
      return;
    }
    setBusy(true);
    // Re-auth check: confirm the current password before flipping.
    const { error: reAuthErr } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (reAuthErr) {
      setBusy(false);
      setErr(t('settings.currentPasswordWrong'));
      return;
    }
    const { error: updateErr } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (updateErr) {
      setErr(t(authErrorKey(updateErr)));
      return;
    }
    setCurrent('');
    setNext('');
    setConfirm('');
    setMsg(t('settings.passwordChanged'));
  };

  return (
    <Card>
      <Text style={styles.sectionTitle}>{t('settings.password')}</Text>
      <Field
        label={t('settings.currentPassword')}
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoComplete="current-password"
      />
      <Field
        label={t('settings.newPassword')}
        value={next}
        onChangeText={setNext}
        secureTextEntry
        autoComplete="new-password"
      />
      <Field
        label={t('auth.callback.confirmPassword')}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
      />
      {err ? <Text style={styles.error}>{err}</Text> : null}
      {msg ? <Text style={styles.success}>{msg}</Text> : null}
      <Button
        label={t('settings.changePassword')}
        onPress={submit}
        loading={busy}
        disabled={!current || !next || !confirm}
      />
    </Card>
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

// Elder only. Off by default: when on, Home shows one gentle line while a
// Trend Watch finding is open — no numbers, no charts.
function TrendLineSection({ initial }: { initial: boolean }) {
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const [on, setOn] = useState(initial);

  const toggle = async (next: boolean) => {
    if (!userId) return;
    setOn(next);
    const { error } = await supabase.from('profiles').update({ trend_line_enabled: next }).eq('id', userId);
    if (error) {
      setOn(!next);
      return;
    }
    qc.invalidateQueries({ queryKey: ['profile-self', userId] });
    qc.invalidateQueries({ queryKey: ['elder-trend-line', userId] });
  };

  return (
    <Card>
      <Text style={styles.sectionTitle}>{t('trends.title')}</Text>
      <SwitchRow label={t('trends.elderToggle')} value={on} onValueChange={toggle} />
      <Text style={styles.body}>{t('trends.elderToggle.help')}</Text>
    </Card>
  );
}

// Elder only. On by default: answering "Not good" to Rafiq's mood question sends
// the family one push that day (step32j); off, the mood is saved but no push goes.
function MoodNoticeSection() {
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const current = useMoodNotice(userId);
  const [on, setOn] = useState<boolean | null>(null);
  const value = on ?? current.data ?? true;

  const toggle = async (next: boolean) => {
    if (!userId) return;
    setOn(next);
    try {
      await setMoodNotice(userId, next);
      qc.setQueryData(moodNoticeKey(userId), next);
    } catch {
      setOn(!next);
    }
  };

  return (
    <Card>
      <Text style={styles.sectionTitle}>{t('settings.moodNotice.title')}</Text>
      <SwitchRow label={t('settings.moodNotice')} value={value} onValueChange={toggle} />
      <Text style={styles.body}>{t('settings.moodNotice.help')}</Text>
    </Card>
  );
}

// Elder only. Pairing needs Bluetooth, which only the phone app will have
// (docs/MOBILE_MIGRATION.md §4); here the elder sees the band and can forget it.
function BandSection() {
  const userId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const status = useBandStatus(userId);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paired = status.data?.paired === true;

  const forget = () =>
    confirm({
      title: t('band.forgetConfirmTitle'),
      message: t('band.forgetConfirmBody'),
      confirmLabel: t('band.forget'),
      cancelLabel: t('common.back'),
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        const { error } = await supabase.rpc('forget_band', {});
        setBusy(false);
        setMsg(error ? error.message : t('band.forgotten'));
        qc.invalidateQueries({ queryKey: ['band_status', userId] });
      },
    });

  return (
    <Card>
      <Text style={styles.sectionTitle}>{t('band.title')}</Text>
      {userId && paired ? <BandStatusCard elderId={userId} self /> : null}
      <Text style={styles.body}>{t('band.pairOnPhone')}</Text>
      {paired ? (
        <Button label={t('band.forget')} variant="secondary" onPress={forget} loading={busy} />
      ) : null}
      {msg ? <Text style={styles.body}>{msg}</Text> : null}
    </Card>
  );
}

function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

// Danger zone: export your data + delete your account. Deletion is a 30-day
// grace request (cancelable). If a deletion is already pending, the section
// flips to a warning banner with a "keep my account" cancel button.
function DangerZone() {
  const [pending, setPending] = useState<DeletionRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setPending(await fetchDeletionStatus());
      } catch {
        /* non-fatal */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onExport = async () => {
    setErr(null);
    setMsg(null);
    setExporting(true);
    try {
      await downloadAccountData();
      setMsg(t('settings.danger.exportDone'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const onDelete = () => {
    confirm({
      title: t('settings.danger.deleteConfirmTitle'),
      message: t('settings.danger.deleteConfirmBody'),
      confirmLabel: t('settings.danger.deleteConfirmCta'),
      cancelLabel: t('common.back'),
      destructive: true,
      onConfirm: () => {
        // Second confirmation — deletion is irreversible after the grace window.
        confirm({
          title: t('settings.danger.deleteConfirm2Title'),
          message: t('settings.danger.deleteConfirm2Body'),
          confirmLabel: t('settings.danger.deleteConfirmCta'),
          cancelLabel: t('common.back'),
          destructive: true,
          onConfirm: async () => {
            setBusy(true);
            setErr(null);
            try {
              const req = await requestAccountDeletion();
              setPending(req);
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          },
        });
      },
    });
  };

  const onCancel = async () => {
    setBusy(true);
    setErr(null);
    try {
      await cancelAccountDeletion();
      setPending(null);
      setMsg(t('settings.danger.cancelDone'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  return (
    <Card style={styles.dangerCard}>
      <Text style={styles.dangerTitle}>{t('settings.danger.title')}</Text>

      <Button
        label={exporting ? t('settings.danger.exporting') : t('settings.danger.export')}
        variant="secondary"
        onPress={onExport}
        loading={exporting}
      />

      {pending ? (
        <View style={styles.deletionBanner}>
          <Text style={styles.deletionText}>
            {t('settings.danger.pendingBanner').replace(
              '{date}',
              formatDate(pending.scheduled_for),
            )}
          </Text>
          <Button
            label={t('settings.danger.keepAccount')}
            onPress={onCancel}
            loading={busy}
          />
        </View>
      ) : (
        <Button
          label={t('settings.danger.delete')}
          variant="danger"
          onPress={onDelete}
          loading={busy}
        />
      )}

      {err ? <Text style={styles.dangerErr}>{err}</Text> : null}
      {msg ? <Text style={styles.dangerOk}>{msg}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  scrollBody: { paddingHorizontal: space.m, paddingBottom: space.xxl, gap: space.l },
  sectionTitle: { ...type.subtitle, color: colors.textPrimary, textAlign: 'left', marginBottom: space.m },
  field: { gap: space.s, marginBottom: space.m },
  fieldLabel: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  readonly: { ...type.body, color: colors.textPrimary, textAlign: 'left', opacity: 0.7 },
  input: {
    minHeight: touch.elderMin,
    backgroundColor: colors.cream,
    borderRadius: radius.xl,
    paddingHorizontal: space.l,
    ...type.body,
    color: colors.textPrimary,
  },
  body: { ...type.body, color: colors.textSecondary, textAlign: 'left' },
  error: { ...type.body, color: colors.alertCritical, textAlign: 'left' },
  success: { ...type.body, color: colors.primary, textAlign: 'left' },
  row: { flexDirection: 'row', gap: space.s, marginBottom: space.m, flexWrap: 'wrap' },
  toggle: {
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    borderRadius: radius.xl,
    backgroundColor: colors.cream,
    minHeight: touch.elderMin,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleActive: { backgroundColor: colors.primary },
  toggleText: { ...type.body, color: colors.textPrimary },
  toggleTextActive: { color: colors.textInverse },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.m,
  },
  switchLabel: { ...type.body, color: colors.textPrimary },
  dangerCard: { gap: space.m, borderWidth: 1, borderColor: colors.alertCritical },
  dangerTitle: { ...type.subtitle, color: colors.alertCritical, textAlign: 'left' },
  deletionBanner: {
    gap: space.m,
    backgroundColor: colors.cream,
    padding: space.m,
    borderRadius: radius.m,
  },
  deletionText: { ...type.body, color: colors.textPrimary, textAlign: 'left' },
  dangerErr: { ...type.body, color: colors.alertCritical, textAlign: 'left' },
  dangerOk: { ...type.body, color: colors.primary, textAlign: 'left' },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.s,
    paddingVertical: space.l,
  },
  legalLink: { ...type.caption, color: colors.textInverse },
  legalDot: { ...type.caption, color: colors.onPrimaryMuted },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.l,
    marginBottom: space.l,
  },
  avatarActions: { flex: 1, gap: space.s },
});
