// Live location screen — where the senior is and what they're doing.
//
// Reached from the Location tab. Data comes from elder_live_location(), which
// is gated on has_perm(elder,'location'); a member without that permission gets
// a clear "not permitted" state rather than an empty map.
//
// The map itself: we show the position card and hand off to the phone's own
// Maps app (Apple Maps / Google Maps). An in-app map (react-native-maps) can
// come later; the web app's OpenStreetMap embed has no native equivalent.
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@react-native-vector-icons/feather';
import { useQuery } from '@tanstack/react-query';
import { safeBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import { formatTime } from '@/lib/i18n';
import { SHARE_EVERY_MS } from '@/lib/shareLocation';
import { Chip, InfoRow } from '@/components/dashboard';
import { colors, radius, space, type } from '@/theme/tokens';

type Circle = {
  circle_id: string;
  elder_id: string;
  elder_name: string | null;
  is_elder: boolean;
};

type Fix = {
  captured_at: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  battery_pct: number | null;
  is_moving: boolean | null;
  zone_name: string | null;
  inside_zone: boolean | null;
};

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function LocationScreen() {
  const [elderId, setElderId] = useState<string | null>(null);

  const circles = useQuery<Circle[]>({
    queryKey: ['my_circles'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_circles');
      if (error) throw error;
      return (data ?? []) as Circle[];
    },
  });

  const elders = useMemo(
    () => (circles.data ?? []).filter((c) => !c.is_elder),
    [circles.data],
  );
  const active = elderId ?? elders[0]?.elder_id ?? null;
  const activeName = elders.find((e) => e.elder_id === active)?.elder_name ?? 'Senior';

  const fix = useQuery<Fix | null>({
    queryKey: ['live_location', active],
    enabled: !!active,
    // Live: re-read while the screen is open.
    refetchInterval: 15000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('elder_live_location', {
        p_elder_id: active,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as Fix | undefined;
      return row ?? null;
    },
  });

  const forbidden = (fix.error as { message?: string } | null)?.message?.includes('forbidden');

  // "Refresh now" re-reads the latest saved position; say when, so a tap is visible
  // even when nothing newer has arrived.
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const { refetch } = fix;
  const refresh = useCallback(async () => {
    await refetch();
    setCheckedAt(Date.now());
  }, [refetch]);

  const openInMaps = useCallback(() => {
    if (!fix.data) return;
    const { lat, lon } = fix.data;
    const url = Platform.select({
      ios: `http://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(activeName)}`,
      android: `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(activeName)})`,
      default: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
    })!;
    void Linking.openURL(url);
  }, [fix.data, activeName]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.nav}>
        <Pressable onPress={safeBack} style={styles.back} accessibilityLabel="Back">
          <Feather name="chevron-left" size={20} color={colors.primary} />
        </Pressable>
        <Text style={styles.navTitle}>Location</Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {elders.length > 1 ? (
          <View style={styles.switcher}>
            {elders.map((e) => {
              const on = e.elder_id === active;
              return (
                <Pressable
                  key={e.elder_id}
                  onPress={() => setElderId(e.elder_id)}
                  style={[styles.switchChip, on && styles.switchChipOn]}
                >
                  <Text style={[styles.switchText, on && styles.switchTextOn]}>
                    {e.elder_name ?? 'Senior'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {circles.isLoading || fix.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : forbidden ? (
          <View style={styles.card}>
            <Feather name="lock" size={28} color={colors.textMuted} />
            <Text style={styles.cardTitle}>Location is not shared with you</Text>
            <Text style={styles.cardBody}>
              Only care-circle members with location permission can see where
              {' '}{activeName} is. Doctors never see location.
            </Text>
          </View>
        ) : !active ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No senior linked yet</Text>
            <Text style={styles.cardBody}>
              Pair with a senior first and their location will appear here.
            </Text>
          </View>
        ) : !fix.data ? (
          <View style={styles.card}>
            <Feather name="map-pin" size={28} color={colors.textMuted} />
            <Text style={styles.cardTitle}>No location yet</Text>
            <Text style={styles.cardBody}>
              {activeName}&rsquo;s device hasn&rsquo;t reported a position yet. It will
              appear here as soon as it does.
            </Text>
          </View>
        ) : (
          <>
            {/* Map */}
            <View style={styles.mapCard}>
              <Pressable style={styles.mapFallback} onPress={openInMaps}>
                <Feather name="map" size={32} color={colors.accent} />
                <Text style={styles.mapFallbackText}>Open in Maps</Text>
              </Pressable>
            </View>

            {/* Status */}
            <View style={styles.statusRow}>
              <Chip
                label={fix.data.inside_zone ? (fix.data.zone_name ?? 'In safe zone') : 'Outside safe zone'}
                tone={fix.data.inside_zone ? 'success' : 'accent'}
              />
              <Text style={styles.updated}>Updated {ago(fix.data.captured_at)}</Text>
            </View>

            <InfoRow
              icon="activity"
              title={fix.data.is_moving ? 'On the move' : 'Not moving'}
              subtitle={
                fix.data.speed_mps != null
                  ? `${(fix.data.speed_mps * 3.6).toFixed(1)} km/h`
                  : 'No movement reported'
              }
            />

            <InfoRow
              icon="battery"
              title="Device battery"
              subtitle={
                fix.data.battery_pct != null ? `${fix.data.battery_pct}%` : 'Not reported'
              }
            />

            <InfoRow
              icon="crosshair"
              title="Position"
              subtitle={`${fix.data.lat.toFixed(5)}, ${fix.data.lon.toFixed(5)}${
                fix.data.accuracy_m != null ? ` · ±${Math.round(fix.data.accuracy_m)}m` : ''
              }`}
              onPress={openInMaps}
            />

            {/* The elder's phone sends a position only while Salem is open on it
                (shareLocation.ts), so refreshing can't fetch a newer one by itself. */}
            {Date.now() - new Date(fix.data.captured_at).getTime() > 2 * SHARE_EVERY_MS ? (
              <Text style={styles.staleNote}>
                {activeName}&rsquo;s phone shares its location only while Salem is open
                on it. Ask them to open Salem for a fresh position.
              </Text>
            ) : null}

            <Pressable
              onPress={refresh}
              disabled={fix.isFetching}
              style={({ pressed }) => [styles.refresh, (pressed || fix.isFetching) && { opacity: 0.7 }]}
              accessibilityRole="button"
            >
              {fix.isFetching ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="refresh-cw" size={16} color={colors.primary} />
              )}
              <Text style={styles.refreshLabel}>{fix.isFetching ? 'Checking…' : 'Refresh now'}</Text>
            </Pressable>
            {checkedAt ? (
              <Text style={styles.checked}>Checked at {formatTime(checkedAt)}</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.l,
    paddingVertical: 12,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: { fontFamily: type.title.fontFamily, fontSize: 16, color: colors.textInverse },
  navSpacer: { width: 36, height: 36 },

  scroll: { paddingHorizontal: 20, paddingBottom: space.xl, gap: space.m },
  center: { paddingVertical: 60, alignItems: 'center' },

  switcher: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  switchChip: {
    paddingHorizontal: space.m,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  switchChipOn: { backgroundColor: colors.surface },
  switchText: { fontFamily: type.cardBody.fontFamily, fontSize: 13, color: colors.textInverse },
  switchTextOn: { color: colors.primary },

  mapCard: {
    height: 260,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  mapInner: { flex: 1 },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s },
  mapFallbackText: { fontFamily: type.subtitle.fontFamily, fontSize: 15, color: colors.accent },

  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  updated: { fontFamily: type.micro.fontFamily, fontSize: 12, color: colors.onPrimaryMuted },
  staleNote: { ...type.cardBody, color: colors.onPrimaryMuted, textAlign: 'center' },
  checked: { fontFamily: type.micro.fontFamily, fontSize: 12, color: colors.onPrimaryMuted, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: space.l,
    gap: space.s,
    alignItems: 'center',
  },
  cardTitle: { ...type.cardTitle, color: colors.textPrimary, textAlign: 'center' },
  cardBody: { ...type.cardBody, color: colors.textSecondary, textAlign: 'center' },

  refresh: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 12,
    marginTop: space.s,
  },
  refreshLabel: { fontFamily: type.subtitle.fontFamily, fontSize: 14, color: colors.primary },
});
