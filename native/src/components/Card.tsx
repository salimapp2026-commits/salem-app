// Card. Borderless per brand spec — depth comes from ambient shadow.
import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, shadow, space } from '@/theme/tokens';

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.l,
    ...shadow.ambient,
  },
});
