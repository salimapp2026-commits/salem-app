// Pieces the Figma frames share: the white round back button, a screen
// header (back + big title, "Settings" frame), and the white menu row.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import { safeBack } from '@/lib/nav';
import { ArrowLeftIcon } from '@/components/icons';
import { t } from '@/lib/i18n';
import { colors, radius, shadow, textStyle, touch } from '@/theme/tokens';

/** Figma "back-button": 40×40 white circle, arrow-left 16 #1e1b4b, shadow 3 % y4 blur 12. */
export function BackButton({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress ?? (() => safeBack())}
      hitSlop={12}
      style={({ pressed }) => [styles.back, shadow.back, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
    >
      <ArrowLeftIcon />
    </Pressable>
  );
}

/** Back button + title, as in the "Settings" frame (Inter 500 36/44, white). */
export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <BackButton />
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

type FeatherName = React.ComponentProps<typeof Feather>['name'];

/** "Caregiver Role Card" row in the Settings frame: white, radius 8, icon + Inter 500 24/29.
 *  At least 64 high for elders (the design's 48 is raised to the elder minimum). */
export function MenuRow({ icon, label, onPress, badge }: { icon: FeatherName; label: string; onPress: () => void; badge?: number }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label} (${badge})` : label}
    >
      <Feather name={icon} size={26} color="#000000" />
      <Text style={styles.rowLabel} numberOfLines={2}>{label}</Text>
      {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { width: 40, height: 40, borderRadius: radius.back, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 },
  title: { ...textStyle({ size: 36, line: 44, weight: 500 }), color: colors.textInverse, flex: 1 },
  right: { minWidth: 40, alignItems: 'flex-end' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: touch.elderMin,
    backgroundColor: colors.surface, borderRadius: radius.s, paddingHorizontal: 24, paddingVertical: 10,
  },
  rowLabel: { ...textStyle({ size: 24, line: 29, weight: 500 }), color: '#000000', flex: 1 },
  badge: { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: colors.alertCritical, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { ...textStyle({ size: 14, line: 17, weight: 700, latin: true }), color: colors.textInverse },
});
