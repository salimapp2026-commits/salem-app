// The indigo shell of the two linking screens — Figma "Accounts link" (52:2298) and
// "QR link" (52:1860): the wordmark, a 36 white round back button, the title, a
// big white headline and a light sub-line; and the four 64×80 digit blocks on the
// white 32-radius card. Inter in the frames; Noto Sans Arabic at the same sizes.
import type { ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { I18nManager } from 'react-native';
import { safeBack } from '@/lib/nav';
import { t } from '@/lib/i18n';
import { colors, textStyle, type TextToken } from '@/theme/tokens';

export function LinkShell({ title, headline, sub, children }: { title: string; headline?: string; sub?: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Image source={require('@/assets/brand/wordmark-white.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Salem" />
        <View style={styles.nav}>
          <Pressable onPress={safeBack} style={styles.back} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <Svg width={20} height={20} viewBox="0 0 20 20" style={I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}>
              <Path d="M12.5 15l-5-5 5-5" stroke={colors.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
          </Pressable>
          <Text style={styles.navTitle} numberOfLines={1}>{title}</Text>
          <View style={styles.navSpacer} />
        </View>
        {headline ? (
          <View style={styles.instructions}>
            <Text style={styles.headline}>{headline}</Text>
            {sub ? <Text style={styles.sub}>{sub}</Text> : null}
          </View>
        ) : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/** The four digit blocks; '' shows an empty block. */
export function CodeBlocks({ code, active }: { code: string; active?: number }) {
  const digits = Array.from({ length: 4 }, (_, i) => code[i] ?? '');
  return (
    <View style={styles.codeCard}>
      {digits.map((d, i) => (
        <View key={i} style={[styles.numBlock, active === i && styles.numBlockActive]}>
          <Text style={styles.num}>{d}</Text>
        </View>
      ))}
    </View>
  );
}

export function WhiteButton({ label, onPress, disabled, tone = 'light' }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'light' | 'outline' }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, tone === 'outline' && styles.buttonOutline, (pressed || disabled) && { opacity: disabled ? 0.45 : 0.85 }]}
      accessibilityRole="button"
    >
      <Text style={[styles.buttonText, tone === 'outline' && { color: colors.textInverse }]}>{label}</Text>
    </Pressable>
  );
}

export function HelpTip({ text }: { text: string }) {
  return (
    <View style={styles.tip}>
      <Svg width={20} height={20} viewBox="0 0 20 20">
        <Path d="M10 18.33a8.33 8.33 0 1 0 0-16.66 8.33 8.33 0 0 0 0 16.66zM7.58 7.5a2.5 2.5 0 0 1 4.86.83c0 1.67-2.5 2.5-2.5 2.5M10 14.17h.01" stroke={colors.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

export const T = {
  navTitle: { size: 16, line: 19, weight: 700 },
  headline: { size: 26, line: 31, weight: 800 },
  sub: { size: 16, line: 22, weight: 400 },
  num: { size: 42, line: 51, weight: 900, latin: true },
  tip: { size: 13, line: 16, weight: 500 },
  button: { size: 16, line: 20, weight: 700 },
  body: { size: 16, line: 22, weight: 500 },
} satisfies Record<string, TextToken>;

const SUB = '#ddeeff';

export const linkStyles = StyleSheet.create({
  error: { ...textStyle(T.body), color: '#ffd6d6', textAlign: 'center', marginHorizontal: 32, marginTop: 16 },
  status: { ...textStyle(T.body), color: colors.textInverse, textAlign: 'center' },
  actions: { gap: 14, marginHorizontal: 32, marginTop: 24 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  scroll: { paddingBottom: 32 },
  logo: { width: 229, height: 83, alignSelf: 'center', marginTop: 24 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  navTitle: { ...textStyle(T.navTitle), color: colors.textInverse, flexShrink: 1, textAlign: 'center' },
  navSpacer: { width: 36, height: 36 },
  instructions: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 40, gap: 12 },
  headline: { ...textStyle(T.headline), color: colors.textInverse, textAlign: 'center' },
  sub: { ...textStyle(T.sub), color: SUB, textAlign: 'center', maxWidth: 320 },
  codeCard: {
    flexDirection: 'row', justifyContent: 'center', gap: 16, backgroundColor: colors.surface, borderRadius: 32,
    marginHorizontal: 32, marginTop: 40, paddingHorizontal: 24, paddingVertical: 48,
  },
  numBlock: { width: 64, height: 80, borderRadius: 16, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  numBlockActive: { borderWidth: 2, borderColor: colors.accent },
  num: { ...textStyle(T.num), color: colors.accent },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginHorizontal: 38, marginTop: 14 },
  tipText: { ...textStyle(T.tip), color: '#666666', flex: 1 },
  button: { minHeight: 64, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonOutline: { backgroundColor: 'transparent', borderWidth: 2, borderColor: colors.surface },
  buttonText: { ...textStyle(T.button), color: colors.primary },
});
