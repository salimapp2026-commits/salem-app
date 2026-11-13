// Shown for any screen that hasn't moved to the native app yet, so the app
// stays navigable during the migration (docs/NATIVE_SCREEN_STATUS.md).
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from '@/navigation/router';
import { colors, radius, space, type } from '@/theme/tokens';

export default function NotPorted() {
  const { path } = useLocalSearchParams<{ path?: string }>();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.title}>Coming to the app soon</Text>
        <Text style={styles.body}>
          This screen hasn’t moved to the new iPhone / Android app yet. It still works in the
          current Salem app.
        </Text>
        {path ? <Text style={styles.path}>{path}</Text> : null}
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>Back</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary, justifyContent: 'center', padding: space.l },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.l, gap: space.m },
  title: { ...type.title, color: colors.textPrimary },
  body: { ...type.body, color: colors.textSecondary },
  path: { ...type.caption, color: colors.textMuted },
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
  btnText: { ...type.subtitle, color: colors.textInverse },
});
