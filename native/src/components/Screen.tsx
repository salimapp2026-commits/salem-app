// Shared screen wrapper. Cream background, safe-area aware, no border lines
// per the brand spec. Children get default horizontal padding.
import { ReactNode } from 'react';
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, space } from '@/theme/tokens';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
};

export function Screen({ children, scroll, style, padded = true }: Props) {
  const Container: any = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Container
        style={[scroll ? null : styles.flex, style]}
        contentContainerStyle={
          scroll
            ? [styles.flexGrow, padded ? styles.padded : null]
            : undefined
        }
      >
        {scroll ? children : (
          <View style={[styles.flex, padded ? styles.padded : null]}>
            {children}
          </View>
        )}
      </Container>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  flex: { flex: 1 },
  flexGrow: { flexGrow: 1 },
  padded: { paddingHorizontal: space.l, paddingVertical: space.l },
});
