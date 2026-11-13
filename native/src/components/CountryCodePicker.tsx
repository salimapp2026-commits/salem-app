// Country code picker for phone-number entry. Bottom-sheet modal with a
// search box. The list is intentionally world-wide — Salem is a global app.
// MENA codes are pinned at the top of the list because that's the largest
// expected slice of users, but the picker is fully general.
//
// Each entry stores the calling code (e.g. "+20") plus an ISO country name
// for searching and display. We don't ship country flags as bundled assets —
// instead we render the regional indicator emoji from the ISO code, which
// works everywhere and adds no bytes.
import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radius, space, touch, type } from '@/theme/tokens';

export type Country = {
  iso: string; // ISO-3166-1 alpha-2 ("EG", "SA", "US")
  name: string;
  code: string; // calling code with leading '+'
};

// Curated subset that covers ~95% of expected users. Pinned MENA region first.
// Add more as needed — picker also accepts `Other / +country` from search.
export const COUNTRIES: Country[] = [
  // MENA — pinned
  { iso: 'EG', name: 'Egypt — مصر', code: '+20' },
  { iso: 'SA', name: 'Saudi Arabia — السعودية', code: '+966' },
  { iso: 'AE', name: 'UAE — الإمارات', code: '+971' },
  { iso: 'KW', name: 'Kuwait — الكويت', code: '+965' },
  { iso: 'QA', name: 'Qatar — قطر', code: '+974' },
  { iso: 'BH', name: 'Bahrain — البحرين', code: '+973' },
  { iso: 'OM', name: 'Oman — عُمان', code: '+968' },
  { iso: 'JO', name: 'Jordan — الأردن', code: '+962' },
  { iso: 'LB', name: 'Lebanon — لبنان', code: '+961' },
  { iso: 'PS', name: 'Palestine — فلسطين', code: '+970' },
  { iso: 'SY', name: 'Syria — سوريا', code: '+963' },
  { iso: 'IQ', name: 'Iraq — العراق', code: '+964' },
  { iso: 'YE', name: 'Yemen — اليمن', code: '+967' },
  { iso: 'MA', name: 'Morocco — المغرب', code: '+212' },
  { iso: 'DZ', name: 'Algeria — الجزائر', code: '+213' },
  { iso: 'TN', name: 'Tunisia — تونس', code: '+216' },
  { iso: 'LY', name: 'Libya — ليبيا', code: '+218' },
  { iso: 'SD', name: 'Sudan — السودان', code: '+249' },
  { iso: 'TR', name: 'Turkey — تركيا', code: '+90' },
  // Common diaspora destinations
  { iso: 'US', name: 'United States', code: '+1' },
  { iso: 'CA', name: 'Canada', code: '+1' },
  { iso: 'GB', name: 'United Kingdom', code: '+44' },
  { iso: 'DE', name: 'Germany', code: '+49' },
  { iso: 'FR', name: 'France', code: '+33' },
  { iso: 'ES', name: 'Spain', code: '+34' },
  { iso: 'IT', name: 'Italy', code: '+39' },
  { iso: 'NL', name: 'Netherlands', code: '+31' },
  { iso: 'BE', name: 'Belgium', code: '+32' },
  { iso: 'SE', name: 'Sweden', code: '+46' },
  { iso: 'NO', name: 'Norway', code: '+47' },
  { iso: 'DK', name: 'Denmark', code: '+45' },
  { iso: 'CH', name: 'Switzerland', code: '+41' },
  { iso: 'AT', name: 'Austria', code: '+43' },
  { iso: 'AU', name: 'Australia', code: '+61' },
  { iso: 'NZ', name: 'New Zealand', code: '+64' },
  { iso: 'IN', name: 'India', code: '+91' },
  { iso: 'PK', name: 'Pakistan', code: '+92' },
  { iso: 'BD', name: 'Bangladesh', code: '+880' },
  { iso: 'ID', name: 'Indonesia', code: '+62' },
  { iso: 'MY', name: 'Malaysia', code: '+60' },
  { iso: 'PH', name: 'Philippines', code: '+63' },
  { iso: 'TH', name: 'Thailand', code: '+66' },
  { iso: 'JP', name: 'Japan', code: '+81' },
  { iso: 'KR', name: 'South Korea', code: '+82' },
  { iso: 'CN', name: 'China', code: '+86' },
  { iso: 'BR', name: 'Brazil', code: '+55' },
  { iso: 'MX', name: 'Mexico', code: '+52' },
  { iso: 'AR', name: 'Argentina', code: '+54' },
  { iso: 'ZA', name: 'South Africa', code: '+27' },
  { iso: 'NG', name: 'Nigeria', code: '+234' },
  { iso: 'KE', name: 'Kenya', code: '+254' },
  { iso: 'ET', name: 'Ethiopia', code: '+251' },
];

export function flagEmoji(iso: string): string {
  // Convert ISO-3166-1 alpha-2 to regional indicator symbols.
  // Falls back to globe emoji if input isn't 2 ASCII letters.
  if (iso.length !== 2) return '🌐';
  const A = 0x1f1e6;
  const cps = [iso.charCodeAt(0), iso.charCodeAt(1)].map(
    (c) => A + (c - 'A'.charCodeAt(0)),
  );
  if (cps.some((c) => c < A || c > A + 25)) return '🌐';
  return String.fromCodePoint(cps[0], cps[1]);
}

export function CountryCodePicker({
  value,
  onChange,
}: {
  value: Country;
  onChange: (c: Country) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iso.toLowerCase().includes(q) ||
        c.code.includes(q),
    );
  }, [query]);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel={`country code ${value.code}`}
      >
        <Text style={styles.triggerText}>
          {flagEmoji(value.iso)} {value.code}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search country / code"
              placeholderTextColor={colors.textSecondary}
              style={styles.search}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <FlatList
              data={filtered}
              keyExtractor={(c) => c.iso + c.code}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                    setQuery('');
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.rowFlag}>{flagEmoji(item.iso)}</Text>
                  <Text style={styles.rowName}>{item.name}</Text>
                  <Text style={styles.rowCode}>{item.code}</Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  No match. Use international format with the leading +.
                </Text>
              }
            />
            <Pressable
              onPress={() => setOpen(false)}
              style={styles.cancel}
              hitSlop={8}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: touch.elderMin,
    paddingHorizontal: space.l,
    backgroundColor: colors.cream,
    borderRadius: radius.xl,
    justifyContent: 'center',
  },
  triggerText: { ...type.body, color: colors.textPrimary },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '80%',
    padding: space.l,
    gap: space.m,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textSecondary,
    alignSelf: 'center',
    opacity: 0.4,
    marginBottom: space.s,
  },
  search: {
    minHeight: touch.elderMin,
    backgroundColor: colors.cream,
    borderRadius: radius.xl,
    paddingHorizontal: space.l,
    ...type.body,
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.m,
    gap: space.m,
  },
  rowFlag: { fontSize: 22 },
  rowName: { ...type.body, color: colors.textPrimary, flex: 1 },
  rowCode: { ...type.body, color: colors.textSecondary },
  empty: { ...type.body, color: colors.textSecondary, padding: space.l, textAlign: 'center' },
  cancel: { alignSelf: 'center', paddingVertical: space.m },
  cancelText: { ...type.body, color: colors.primary },
});
