// Role selection — laid out to the "Salem UI UX" Figma "Choose your experience"
// frame: indigo field, wordmark, tagline, and white role cards with a blue
// circular icon, title, description and chevron.
//
// Persists the chosen role to profiles.role and refreshes the auth store so the
// gate routes the user to the right dashboard.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from '@/navigation/router';
import { Feather } from '@react-native-vector-icons/feather';
import { supabase } from '@/lib/supabase';
import { useAuthStore, type AppRole } from '@/stores/authStore';
import { confirm } from '@/lib/confirm';
import { colors, radius, space, type } from '@/theme/tokens';
import { t } from '@/lib/i18n';

type Choice = {
  value: AppRole;
  label: string;
  description?: string;
  titleColor: string;
};

// Matches the Figma card order and title colours (parent/doctor indigo,
// caregiver accent blue).
const CHOICES: Choice[] = [
  {
    value: 'elder',
    label: 'I am a parent',
    description: 'Simple buttons, big text, voice companion',
    titleColor: colors.primary,
  },
  {
    value: 'family',
    label: 'I am a Caregiver',
    description: 'Real-time health stats, alerts & summaries',
    titleColor: colors.accent,
  },
  { value: 'doctor', label: 'I am a Doctor', titleColor: colors.primary },
];

export default function RoleSelect() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  const refreshRole = useAuthStore((s) => s.refreshRole);
  const signOut = useAuthStore((s) => s.signOut);
  const roleChosen = useAuthStore((s) => s.roleChosen);
  const [busy, setBusy] = useState<AppRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Someone who already chose (their role read arrived late, or they chose just
  // now) goes back through the gate to their dashboard.
  useEffect(() => {
    if (roleChosen) router.replace('/');
  }, [roleChosen, router]);

  // No real "back" — onboarding is reached right after signup with no useful
  // history. The escape hatch is to sign out so the user can try a different
  // account.
  const onBack = () =>
    confirm({
      title: t('settings.signOutConfirmTitle'),
      confirmLabel: t('common.signOut'),
      cancelLabel: t('common.back'),
      destructive: true,
      onConfirm: signOut,
    });

  // The Figma cards are the action themselves — tapping one commits the role,
  // so there is no separate Continue button.
  //
  // This choice is PERMANENT. A database trigger (step24_role_is_permanent)
  // rejects any later change; to use Salem differently the person signs out and
  // creates a new account.
  const choose = async (role: AppRole) => {
    if (!userId || busy) return;
    setBusy(role);
    setError(null);
    const { error: err } = await supabase
      .from('profiles')
      .update({ role, role_chosen_at: new Date().toISOString() })
      .eq('id', userId);
    if (err) {
      setError(err.message);
      setBusy(null);
      return;
    }
    await refreshRole();
    setBusy(null);
    // Chosen → the effect above moves on. Otherwise the gate offers "Try again".
    if (!useAuthStore.getState().roleChosen) router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.back} accessibilityLabel={t('common.back')}>
          <Feather name="log-out" size={20} color={colors.onPrimaryMuted} />
        </Pressable>

        <Image
          source={require('@/assets/brand/wordmark-white.png')}
          style={styles.wordmark}
          resizeMode="contain"
          accessibilityLabel="Salem"
        />
        <Text style={styles.tagline}>"Their Companion, Your Peace of Mind"</Text>
        <Text style={styles.sectionLabel}>CHOOSE YOUR EXPERIENCE</Text>

        <View style={styles.list}>
          {CHOICES.map((c) => (
            <Pressable
              key={c.value}
              onPress={() => choose(c.value)}
              disabled={!!busy}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
              accessibilityLabel={c.label}
            >
              <View style={styles.iconCircle}>
                <Feather name="user" size={32} color={colors.textInverse} />
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: c.titleColor }]}>{c.label}</Text>
                {c.description ? (
                  <Text style={styles.cardDesc}>{c.description}</Text>
                ) : null}
              </View>
              {busy === c.value ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Feather name="chevron-right" size={20} color={c.titleColor} />
              )}
            </Pressable>
          ))}
        </View>

        <Text style={styles.permanentNote}>
          You can only choose once. To use Salem in a different role later,
          sign out and create a new account.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  scroll: { paddingHorizontal: space.l, paddingBottom: space.xl, alignItems: 'center' },
  back: { alignSelf: 'flex-start', padding: space.s },
  wordmark: { width: 200, height: 72, marginTop: space.s },
  tagline: {
    ...type.body,
    fontFamily: type.subtitle.fontFamily,
    color: colors.onPrimaryMuted,
    textAlign: 'center',
    marginTop: space.s,
  },
  sectionLabel: {
    fontFamily: type.subtitle.fontFamily,
    fontSize: 15,
    color: colors.onPrimaryMuted,
    textAlign: 'center',
    marginTop: space.xl,
    marginBottom: space.m,
  },
  list: { alignSelf: 'stretch', gap: 20 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    backgroundColor: colors.surface,
    borderRadius: radius.s,
    padding: space.l,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 4 },
  cardTitle: { fontFamily: type.title.fontFamily, fontSize: 18 },
  cardDesc: { fontFamily: type.cardBody.fontFamily, fontSize: 13, color: colors.textSecondary },
  permanentNote: {
    fontFamily: type.caption.fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: colors.onPrimaryMuted,
    textAlign: 'center',
    marginTop: space.l,
  },
  error: {
    ...type.body,
    color: colors.textInverse,
    textAlign: 'center',
    marginTop: space.m,
  },
});
