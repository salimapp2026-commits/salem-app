// Brand button. Solid indigo primary with elder-tier touch target.
//
// Variants:
//   primary      — indigo fill, white label. For use on white/cream surfaces.
//   secondary    — white fill, indigo label. The primary action ON the indigo
//                  field, where `primary` would be indigo-on-indigo.
//   ghost        — transparent, indigo label. White/cream surfaces only.
//   ghostInverse — transparent, white label. The ghost for the indigo field;
//                  a plain `ghost` there is invisible.
//   danger       — destructive red.
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, shadow, space, touch, type } from '@/theme/tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'ghostInverse' | 'danger';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  fullWidth = true,
}: Props) {
  const stateBlocked = disabled || loading;
  return (
    <Pressable
      onPress={stateBlocked ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        fullWidth ? styles.full : null,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        (variant === 'ghost' || variant === 'ghostInverse') && styles.ghost,
        variant === 'danger' && styles.danger,
        pressed && !stateBlocked && styles.pressed,
        stateBlocked && styles.disabled,
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!stateBlocked }}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator
            color={
              variant === 'primary' || variant === 'danger' || variant === 'ghostInverse'
                ? colors.textInverse
                : colors.primary
            }
          />
        ) : (
          <Text
            style={[
              styles.label,
              variant === 'primary' && { color: colors.textInverse },
              variant === 'danger' && { color: colors.textInverse },
              variant === 'ghostInverse' && { color: colors.textInverse },
              (variant === 'secondary' || variant === 'ghost') && {
                color: colors.primary,
              },
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.elderMin,
    borderRadius: radius.xl,
    paddingHorizontal: space.l,
    justifyContent: 'center',
    alignItems: 'center',
  },
  full: { alignSelf: 'stretch' },
  primary: {
    backgroundColor: colors.primary,
    ...shadow.ambient,
  },
  secondary: {
    backgroundColor: colors.surface,
  },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: colors.alertCritical },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', gap: space.s, alignItems: 'center' },
  label: { ...type.subtitle, textAlign: 'center' },
});
