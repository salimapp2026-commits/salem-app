// Family-side health-alerts dashboard. Chronological feed of every alert
// the caregiver has visibility into (gated by `has_perm(elder_id, 'health')`
// via the recent_health_alerts RPC). Each row shows the alert kind, the
// elder's name, severity, "time ago", and any AI explanation we already
// generated. Tapping a row expands to show the recommended action and an
// Acknowledge button.
//
// Two view modes:
//   • All — every alert in the last 50
//   • Unacknowledged — same query with p_unacknowledged_only=true; this is
//     the default because that's what caregivers usually care about
//
// Realtime: subscribes to INSERT/UPDATE on health_alerts. We invalidate the
// query rather than try to patch the local cache, since each new row also
// pulls AI assessment data we'd otherwise have to fetch by hand.
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from '@/navigation/router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import {
  FieldCard,
  FieldEmpty,
  FieldScreen,
  FilterChips,
  SubHeader,
} from '@/components/dashboard';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/theme/tokens';
import { isolate, t } from '@/lib/i18n';
import { bandAlertNote, bandAlertText, bandKindLabel } from '@/lib/band';
import { AlertLocationLink } from '@/components/AlertLocationLink';

type AlertRow = {
  id: string;
  elder_id: string;
  elder_name: string | null;
  kind:
    | 'sos' | 'fall_detected' | 'hr_high' | 'hr_low'
    | 'spo2_low' | 'zone_exit' | 'low_battery' | 'no_movement' | 'med_missed'
    | 'trend' | 'band_off_wrist' | 'band_no_data' | 'rafiq';
  severity: 'info' | 'warning' | 'critical';
  payload: Record<string, unknown>;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
};

type Filter = 'unack' | 'all';

export default function FamilyAlerts() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('unack');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const alerts = useQuery<AlertRow[]>({
    queryKey: ['health-alerts', filter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recent_health_alerts', {
        p_limit: 50,
        p_unacknowledged_only: filter === 'unack',
      });
      if (error) throw error;
      return (data ?? []) as AlertRow[];
    },
  });

  // Realtime: any new alert or ack flips the cache so the feed stays current
  // without a manual refresh. We just invalidate — Supabase realtime will
  // also flow through for the recipient's notification_log via OneSignal.
  useEffect(() => {
    const channel = supabase
      .channel('family-health-alerts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'health_alerts' },
        () => {
          qc.invalidateQueries({ queryKey: ['health-alerts'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const ack = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase.rpc('acknowledge_health_alert', {
        p_alert_id: alertId,
        p_resolved: false,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health-alerts'] }),
  });

  const counts = useMemo(() => {
    const a = alerts.data ?? [];
    return {
      total: a.length,
      critical: a.filter((x) => x.severity === 'critical' && !x.acknowledged_at).length,
    };
  }, [alerts.data]);

  return (
    <FieldScreen>
      <SubHeader
        title="Health alerts"
        right={
          counts.critical > 0 ? (
            <View style={styles.criticalBadge}>
              <Text style={styles.criticalBadgeText}>{counts.critical}</Text>
            </View>
          ) : undefined
        }
      />

      <View style={styles.filterRow}>
        <FilterChips<Filter>
          items={[
            { key: 'unack', label: 'Unacknowledged', icon: 'bell' },
            { key: 'all', label: 'All', icon: 'list' },
          ]}
          active={filter}
          onSelect={setFilter}
        />
      </View>

      <FlatList
        data={alerts.data ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <AlertCardRow
            alert={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onAcknowledge={() => ack.mutate(item.id)}
            ackBusy={ack.isPending && ack.variables === item.id}
          />
        )}
        ListEmptyComponent={
          <FieldEmpty
            text={
              alerts.isLoading
                ? t('common.loading')
                : filter === 'unack'
                ? 'No unacknowledged alerts.'
                : 'No alerts yet.'
            }
          />
        }
        refreshing={alerts.isFetching}
        onRefresh={() => alerts.refetch()}
      />
    </FieldScreen>
  );
}

function AlertCardRow({
  alert,
  expanded,
  onToggle,
  onAcknowledge,
  ackBusy,
}: {
  alert: AlertRow;
  expanded: boolean;
  onToggle: () => void;
  onAcknowledge: () => void;
  ackBusy: boolean;
}) {
  const ackd = !!alert.acknowledged_at;
  return (
    <Pressable onPress={onToggle} style={({ pressed }) => [pressed && { opacity: 0.92 }]}>
      <FieldCard style={[styles.row, severityBorder(alert.severity), ackd && styles.rowAcked]}>
        <View style={styles.rowHead}>
          <View style={[styles.severityChip, severityChipStyle(alert.severity)]}>
            <Text style={styles.severityChipText}>{severityLabel(alert.severity)}</Text>
          </View>
          <Text style={styles.kindLabel}>{alert.kind === 'sos' && alert.payload?.source === 'rafiq_chat' ? t('alerts.kind.crisis') : kindLabel(alert.kind)}</Text>
        </View>
        <View style={styles.rowMeta}>
          <Text style={styles.metaText}>
            {isolate(alert.elder_name) || 'Senior'} · {ago(alert.created_at)}
          </Text>
          {ackd ? <Text style={styles.ackedText}>Acknowledged</Text> : null}
        </View>
        {bandAlertNote(alert) ? <Text style={styles.bandNote}>{bandAlertNote(alert)}</Text> : null}
        {bandAlertText(alert) ? (
          <Text style={styles.explanation} numberOfLines={expanded ? undefined : 2}>
            {bandAlertText(alert)}
          </Text>
        ) : null}
        <AlertLocationLink alertId={alert.id} elderId={alert.elder_id} kind={alert.kind} createdAt={alert.created_at} />
        {alert.kind === 'rafiq' ? <RafiqLink elderId={alert.elder_id} /> : null}
        {expanded && !ackd ? (
          <Button label="Acknowledge" onPress={onAcknowledge} loading={ackBusy} />
        ) : null}
      </FieldCard>
    </Pressable>
  );
}

function kindLabel(k: AlertRow['kind']): string {
  switch (k) {
    case 'sos': return 'SOS';
    case 'fall_detected': return 'Fall detected';
    case 'hr_high': return 'Heart rate high';
    case 'hr_low': return 'Heart rate low';
    case 'spo2_low': return 'Oxygen low';
    case 'zone_exit': return 'Left safe zone';
    case 'low_battery': return 'Low battery';
    case 'no_movement': return 'No movement';
    case 'med_missed': return 'Missed medication';
    // Details stay in read-health-protected trend_findings; the alert names
    // only the feature.
    case 'trend': return t('alerts.kind.trend');
    // Details stay in read-health-protected rafiq_alerts; the row links there.
    case 'rafiq': return 'Rafiq: a change worth checking';
    case 'band_off_wrist':
    case 'band_no_data': return bandKindLabel(k)!;
  }
}

function severityLabel(s: AlertRow['severity']): string {
  if (s === 'critical') return 'Critical';
  if (s === 'warning') return 'Warning';
  return 'Info';
}

// The accent stripe sits on the leading edge — left, now the UI ships LTR.
function severityBorder(s: AlertRow['severity']) {
  if (s === 'critical') return { borderLeftWidth: 4, borderLeftColor: colors.alertCritical };
  if (s === 'warning') return { borderLeftWidth: 4, borderLeftColor: colors.alertWarning };
  return { borderLeftWidth: 4, borderLeftColor: colors.alertInfo };
}

function severityChipStyle(s: AlertRow['severity']) {
  if (s === 'critical') return { backgroundColor: colors.alertCritical };
  if (s === 'warning') return { backgroundColor: colors.alertWarning };
  return { backgroundColor: colors.alertInfo };
}

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const styles = StyleSheet.create({
  criticalBadge: {
    paddingHorizontal: space.m,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.alertCritical,
  },
  criticalBadgeText: { ...type.caption, color: colors.textInverse, fontWeight: '700' },
  filterRow: { paddingHorizontal: space.m, paddingBottom: space.m },
  list: { paddingHorizontal: space.m, gap: space.m, paddingBottom: space.xxl },
  row: { paddingHorizontal: space.m, paddingVertical: space.m },
  rowAcked: { opacity: 0.7 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  severityChip: {
    paddingHorizontal: space.m,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  severityChipText: { ...type.caption, color: colors.textInverse, fontWeight: '700' },
  kindLabel: { ...type.subtitle, color: colors.textPrimary, flex: 1, textAlign: 'left' },
  rowMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  metaText: { ...type.caption, color: colors.textSecondary },
  bandNote: { ...type.caption, color: colors.primary, fontWeight: '600', textAlign: 'left' },
  ackedText: { ...type.caption, color: colors.primary, fontWeight: '700' },
  explanation: { ...type.body, color: colors.textPrimary, textAlign: 'left' },
  actionBox: {
    backgroundColor: colors.cream,
    padding: space.m,
    borderRadius: radius.m,
    gap: space.xs,
  },
  actionLabel: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  actionText: { ...type.body, color: colors.textPrimary, textAlign: 'left' },
});

/** Rafiq alerts carry no details in the alert row (the whole circle can read
 *  alerts); the reason lives in Rafiq, behind the read-health permission. */
function RafiqLink({ elderId }: { elderId: string }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/rafiq', params: { elderId } })}
      accessibilityRole="link"
      style={({ pressed }) => [{ paddingVertical: 4 }, pressed && { opacity: 0.7 }]}
    >
      <Text style={{ ...type.cardBody, color: colors.accent, textAlign: 'left' }}>See why in Rafiq →</Text>
    </Pressable>
  );
}
