// Auth chrome, built to match the Salem visual-identity mockup exactly:
// full-bleed indigo field, each input introduced by a filled white icon badge
// plus a lowercase label, white pill inputs, a white pill CTA, and the smile
// mark centred underneath.
//
// Auth logic stays in the screens; this module only owns presentation.
import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, type } from '@/theme/tokens';

// Screen background — the indigo used on the identity's app screens, which is
// the app-wide primary so auth and the rest of the app stay in step.
export const AUTH_BG = colors.primary;

export function AuthScreen({
  children,
  showWordmark = true,
}: {
  children: ReactNode;
  showWordmark?: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {showWordmark ? (
            <Image
              source={require('@/assets/brand/wordmark-white.png')}
              style={styles.wordmark}
              resizeMode="contain"
              accessibilityLabel="Salem"
            />
          ) : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Filled white icon badge + lowercase label, above a white pill input.
export function AuthField({
  icon,
  label,
  ...inputProps
}: React.ComponentProps<typeof TextInput> & {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <View style={styles.iconBadge}>
          <Ionicons name={icon} size={17} color={AUTH_BG} />
        </View>
        <Text style={styles.label}>{label}</Text>
      </View>
      <TextInput
        {...inputProps}
        style={styles.input}
        placeholderTextColor="#a9a9b8"
        textAlign="left"
      />
    </View>
  );
}

// White pill CTA with indigo label.
export function AuthButton({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const blocked = disabled || loading;
  return (
    <Pressable
      onPress={blocked ? undefined : onPress}
      style={({ pressed }) => [
        styles.cta,
        pressed && !blocked && styles.ctaPressed,
        blocked && styles.ctaDisabled,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!blocked }}
    >
      {loading ? (
        <ActivityIndicator color={AUTH_BG} />
      ) : (
        <Text style={styles.ctaLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

// Secondary action — plain white text on the indigo field.
export function AuthLink({
  label,
  onPress,
}: {
  label: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.link}>
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

// The smile mark that closes the screen in the mockup.
export function AuthSmile() {
  return (
    <Image
      source={require('@/assets/brand/smile-white.png')}
      resizeMode="contain"
      style={styles.smile}
      accessible={false}
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AUTH_BG },
  flex: { flex: 1 },
  wordmark: { width: 200, height: 72, alignSelf: 'center', marginBottom: 28 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 26,
    paddingTop: 44,
    paddingBottom: 28,
  },
  field: { marginBottom: 26 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    paddingLeft: 2,
  },
  iconBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...type.subtitle,
    fontSize: 21,
    lineHeight: 28,
    color: '#ffffff',
    fontWeight: '700',
  },
  input: {
    minHeight: 62,
    backgroundColor: '#ffffff',
    borderRadius: 31,
    paddingHorizontal: 24,
    ...type.body,
    fontSize: 17,
    color: '#1a1a2e',
  },
  cta: {
    minHeight: 66,
    borderRadius: 33,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    alignSelf: 'stretch',
    marginTop: 16,
  },
  ctaPressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },
  ctaDisabled: { opacity: 0.55 },
  ctaLabel: {
    ...type.subtitle,
    fontSize: 21,
    color: AUTH_BG,
    fontWeight: '700',
    textAlign: 'center',
  },
  link: { alignSelf: 'center', paddingVertical: 12 },
  linkText: { ...type.body, color: '#ffffff', textAlign: 'center' },
  smile: {
    width: 48,
    height: 31,
    alignSelf: 'center',
    marginTop: 26,
  },
});
