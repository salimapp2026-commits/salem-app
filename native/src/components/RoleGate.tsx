// Guard for the elder / family / doctor screens (the Expo app's group layouts).
//
// Auth is restored asynchronously, so on a cold start the store briefly
// reports "no session" and "no role". Redirecting during that window would
// bounce a signed-in user to sign-in, so we hold on a spinner until auth has
// settled, then let the screen render only for the right role.
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Redirect } from '@/navigation/router';
import { useAuthStore, bucketForRole, type RoleBucket } from '@/stores/authStore';
import { colors, space, type } from '@/theme/tokens';
import { t } from '@/lib/i18n';

export function RoleGate({ bucket, children }: { bucket: RoleBucket; children: ReactNode }) {
  const { bootstrapping, roleLoaded, session, role } = useAuthStore();

  if (bootstrapping || (session && !roleLoaded)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.label}>{t('common.loading')}</Text>
      </View>
    );
  }
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  if (bucketForRole(role) !== bucket) return <Redirect href="/" />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.m,
  },
  label: { ...type.body, color: colors.textSecondary },
});
