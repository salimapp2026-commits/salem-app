// Circular profile photo. If `url` is set, renders the image. Otherwise
// falls back to a colored circle with the first letter of `displayName`.
// The fallback handles any string — Latin, Arabic, mixed — by extracting
// the first non-whitespace character.
//
// Sizes: pass a `size` (px) — defaults to 48. We compute font size as
// ~45% of the diameter so initials always fit cleanly.
import { Image, StyleSheet, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { colors, type } from '@/theme/tokens';

export function Avatar({
  url,
  displayName,
  size = 48,
  style,
}: {
  url?: string | null;
  displayName?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const dim = { width: size, height: size, borderRadius: size / 2 };

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={[dim, styles.bg, style as StyleProp<ImageStyle>]}
        accessibilityLabel={displayName ?? 'avatar'}
      />
    );
  }

  const letter = firstLetter(displayName);
  const fontSize = Math.max(12, Math.round(size * 0.45));

  return (
    <View
      style={[
        dim,
        styles.fallback,
        { backgroundColor: colorFor(displayName) },
        style,
      ]}
      accessibilityLabel={displayName ?? 'avatar'}
    >
      <Text style={[styles.letter, { fontSize }]}>{letter}</Text>
    </View>
  );
}

function firstLetter(name?: string | null): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // Use the iterator so multi-byte glyphs (Arabic + emoji) count as one.
  for (const ch of trimmed) {
    if (ch.trim().length > 0) return ch.toUpperCase();
  }
  return '?';
}

// Deterministic color based on the name so the same person gets the same
// fallback color across sessions. Hash the string into one of N brand-ish
// hues — staying in the indigo/blue family for visual coherence with the brand.
const PALETTE = ['#2557e0', '#1a3fb0', '#3a9aff', '#2f6fe0', '#4f7ceb'];
function colorFor(name?: string | null): string {
  if (!name) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

const styles = StyleSheet.create({
  bg: { backgroundColor: colors.cream },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  letter: { ...type.subtitle, color: '#fff', fontWeight: '700' },
});
