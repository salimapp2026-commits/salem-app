// Auth gate. Redirects based on (a) configuration sanity, (b) auth state,
// (c) role. Shows a loading splash while bootstrap is in flight.
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect } from '@/navigation/router';
import { useAuthStore, bucketForRole } from '@/stores/authStore';
import { supabaseConfigured } from '@/lib/supabase';
import { colors, radius, space, type } from '@/theme/tokens';
import { t } from '@/lib/i18n';

export default function Index() {
  const { bootstrapping, roleLoaded, roleChosen, roleReadFailed, session, role, retryRole } =
    useAuthStore();

  if (!supabaseConfigured) {
    return (
      <View style={styles.center}>
        <Text style={styles.brand}>salem</Text>
        <Text style={styles.warn}>
          EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY must be set
          in .env before the app can connect.
        </Text>
      </View>
    );
  }

  // Also wait while a just-signed-in user's role is still being fetched.
  if (bootstrapping || (session && !roleLoaded)) {
    return (
      <View style={styles.center}>
        <Text style={styles.brand}>salem</Text>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.subtle}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/sign-in" />;

  // The role couldn't be read (no network, or the session still refreshing). Not
  // role-select: an existing user choosing there would overwrite their real role.
  // A token refresh reads again by itself; this screen then moves on.
  if (roleReadFailed && !roleChosen) {
    return (
      <View style={styles.center}>
        <Text style={styles.brand}>salem</Text>
        <Text style={styles.title}>{t('gate.cantLoad.title')}</Text>
        <Text style={styles.subtle}>{t('gate.cantLoad.body')}</Text>
        <Pressable
          onPress={retryRole}
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{t('common.tryAgain')}</Text>
        </Pressable>
      </View>
    );
  }

  // profiles.role defaults to 'elder', so a brand-new account always has a
  // role. Onboarding is driven by whether they have actually CHOSEN one.
  const bucket = bucketForRole(role);
  if (!roleChosen || !bucket) return <Redirect href="/(onboarding)/role-select" />;
  if (bucket === 'elder') return <Redirect href="/(elder)" />;
  if (bucket === 'doctor') return <Redirect href="/(doctor)" />;
  return <Redirect href="/(family)" />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.l,
  },
  brand: { ...type.display, color: colors.primary },
  subtle: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  title: { ...type.title, color: colors.textPrimary, textAlign: 'center' },
  button: {
    minHeight: 64,
    alignSelf: 'stretch',
    borderRadius: radius.button,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { ...type.subtitle, color: colors.textInverse },
  warn: { ...type.body, color: colors.alertCritical, textAlign: 'center' },
});
