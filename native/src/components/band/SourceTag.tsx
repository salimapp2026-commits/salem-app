// Tiny pill that marks a reading as coming from the Salem Band — and, for a
// band heart-rate / oxygen reading below the quality threshold, "weak signal"
// (stored, but not used for alerts or Trend Watch).
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import { isBandReading, isWeakSignal } from '@/lib/band';
import { t } from '@/lib/i18n';
import { colors, radius, type } from '@/theme/tokens';

export function SourceTag({
  reading,
}: {
  reading: { source?: string | null; kind?: string; quality?: number | null } | null | undefined;
}) {
  if (!isBandReading(reading)) return null;
  const weak = isWeakSignal(reading);
  return (
    <View style={[styles.tag, weak && styles.weak]} accessibilityLabel={weak ? `${t('band.source')}, ${t('band.weakSignal')}` : t('band.source')}>
      <Feather name="watch" size={10} color={weak ? colors.alertWarning : colors.accent} />
      <Text style={[styles.text, weak && styles.weakText]}>
        {weak ? `${t('band.source')} · ${t('band.weakSignal')}` : t('band.source')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  weak: { backgroundColor: '#fff4dc' },
  text: { ...type.micro, fontSize: 10, color: colors.accent },
  weakText: { color: colors.alertWarning },
});
