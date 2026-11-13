// Animated brand entrance, per the Salem visual identity.
//   A white welcome screen: the blue logo mark POPS out in the middle of the
//   screen (bouncy scale), and "welcome to salem" sits pinned at the bottom.
//   The whole overlay then fades out to reveal the app.
// Uses the built-in Animated API. Mounted once at the root; calls onDone when
// the sequence finishes.
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';
import { colors, type } from '@/theme/tokens';

// The web build has no native animation module; drive on the UI thread only
// on native to avoid a noisy dev warning (JS-based fallback on web is fine).
const NATIVE = Platform.OS !== 'web';

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const markScale = useRef(new Animated.Value(0.2)).current; // pop-in scale
  const markOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textShift = useRef(new Animated.Value(12)).current; // subtle rise
  const overall = useRef(new Animated.Value(1)).current; // whole-overlay opacity

  // Held in a ref so a new inline callback from the parent can't restart the
  // sequence mid-flight — the effect below must run exactly once.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  // Guards against the completion callback and the fallback timer both firing.
  const doneRef = useRef(false);

  useEffect(() => {
    Animated.sequence([
      // The mark pops out in the middle (spring overshoot = the "pop").
      Animated.parallel([
        Animated.spring(markScale, {
          toValue: 1,
          friction: 5,
          tension: 90,
          useNativeDriver: NATIVE,
        }),
        Animated.timing(markOpacity, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: NATIVE,
        }),
      ]),
      // "welcome to salem" rises in at the bottom just after.
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: NATIVE,
        }),
        Animated.timing(textShift, {
          toValue: 0,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: NATIVE,
        }),
      ]),
      Animated.delay(1100),
      // Fade the whole entrance away to reveal the app.
      Animated.timing(overall, {
        toValue: 0,
        duration: 420,
        easing: Easing.in(Easing.quad),
        useNativeDriver: NATIVE,
      }),
    ]).start(({ finished }) => {
      if (finished) finish();
    });

    // Safety net: never let a stalled animation leave the overlay covering the
    // app. Animated's completion callback is not reliable on every platform
    // (notably web without the native driver), so a timer force-finishes just
    // past the sequence's natural length.
    const TOTAL_MS = 2600;
    const fallback = setTimeout(finish, TOTAL_MS + 400);

    function finish() {
      if (doneRef.current) return;
      doneRef.current = true;
      clearTimeout(fallback);
      overall.setValue(0);
      onDoneRef.current();
    }

    return () => clearTimeout(fallback);
    // Intentionally empty: the entrance plays once per app launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { opacity: overall }]}
      pointerEvents="none"
    >
      {/* Logo mark — centered in the middle of the screen, pops in. */}
      <Animated.Image
        source={require('@/assets/brand/mark-blue.png')}
        resizeMode="contain"
        style={[
          styles.mark,
          { opacity: markOpacity, transform: [{ scale: markScale }] },
        ]}
      />

      {/* "welcome to salem" — pinned to the bottom of the screen. */}
      <Animated.Text
        style={[
          styles.welcome,
          { opacity: textOpacity, transform: [{ translateY: textShift }] },
        ]}
      >
        welcome to salem
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: 100,
    elevation: 100,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { width: 168, height: 172 },
  welcome: {
    ...type.subtitle,
    color: colors.primary,
    letterSpacing: 0.3,
    position: 'absolute',
    bottom: 72,
    alignSelf: 'center',
  },
});
