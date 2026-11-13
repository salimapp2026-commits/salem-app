// "Last known location" under an SOS / fall alert. Reads alert_locations,
// whose row-level security already decides who sees it: the elder and members
// with the location permission — never doctors — on every plan. For anyone
// else the query returns nothing and this renders nothing. When the phone sent
// no position (no permission, location off, no fix in 10 s), members who may
// see location are told so (lib/alertLocationState.ts).
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@react-native-vector-icons/feather';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatDateTime, t, tf } from '@/lib/i18n';
import { mapsUrl } from '@/supabase/functions/_shared/alertLocation';
import { alertLocationState } from '@/lib/alertLocationState';
import { colors, radius, space, type } from '@/theme/tokens';

type Loc = { lat: number; lon: number; captured_at: string; source: string };

export function AlertLocationLink({ alertId, elderId, kind, createdAt }: {
  alertId: string; elderId: string; kind: string; createdAt: string;
}) {
  const emergency = kind === 'sos' || kind === 'fall_detected';
  // add_sos_location accepts a position for 15 minutes after the alert.
  const updatable = Date.now() - new Date(createdAt).getTime() < 15 * 60_000;
  const loc = useQuery<Loc | null>({
    queryKey: ['alert_location', alertId],
    enabled: emergency,
    // The device's own position can arrive seconds after the SOS ("Location
    // update"); keep looking until it is there.
    refetchInterval: (q) => (updatable && q.state.data?.source !== 'sos_button' ? 30_000 : false),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alert_locations')
        .select('lat, lon, captured_at, source')
        .eq('alert_id', alertId)
        .maybeSingle();
      if (error) return null;
      return data as Loc | null;
    },
  });
  const maySee = useQuery<boolean>({
    queryKey: ['can_read_location', elderId],
    enabled: emergency && loc.isFetched && !loc.data,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_read_location', { p_elder_id: elderId });
      return !error && data === true;
    },
  });
  const state = alertLocationState({
    kind,
    ageMs: Date.now() - new Date(createdAt).getTime(),
    hasLocation: !!loc.data,
    viewerMaySeeLocation: maySee.data ?? null,
  });
  if (state === 'missing') {
    return (
      <View style={[styles.link, styles.missing]} accessibilityRole="text">
        <Feather name="map-pin" size={16} color={colors.alertWarning} />
        <Text style={[styles.text, styles.missingText]}>{t('alerts.locationMissing')}</Text>
      </View>
    );
  }
  if (state !== 'link' || !loc.data) return null;
  const url = mapsUrl(loc.data.lat, loc.data.lon);
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.85 }]}
      accessibilityRole="link"
      accessibilityLabel={t('alerts.lastLocation')}
    >
      <Feather name="map-pin" size={16} color={colors.primary} />
      <Text style={styles.text}>
        {/* sos_button = the position the device sent after the alert went out */}
        {tf(loc.data.source === 'sos_button' ? 'alerts.locationUpdateAt' : 'alerts.lastLocationAt',
          { time: formatDateTime(loc.data.captured_at) })}
      </Text>
      <Feather name="external-link" size={14} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    alignSelf: 'flex-start',
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  text: { ...type.caption, color: colors.primary, fontWeight: '600' },
  missing: { backgroundColor: '#fff4dc', alignSelf: 'stretch' },
  missingText: { color: colors.alertWarning, flexShrink: 1 },
});
