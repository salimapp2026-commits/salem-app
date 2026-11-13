// Doctor-side health-alerts dashboard. Same RPC as the family screen —
// `recent_health_alerts` is gated by `has_perm(elder_id, 'health')`, so a
// doctor sees alerts only for patients they're in the care circle of with
// the doctor role.
//
// Doctor-specific tweaks vs the family screen:
//   • Header title — "Patient alerts", not "Health alerts"
//   • A per-patient filter chip row in addition to the severity filter, so
//     a doctor monitoring many elders can drill into one at a time
//   • Tapping a row also exposes an "Open patient file" button that routes
//     into the per-patient drilldown — doctors typically need that next
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

export default function DoctorAlerts() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('unack');
  const [patientFilter, setPatientFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const alerts = useQuery<AlertRow[]>({
    queryKey: ['doctor-alerts', filter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recent_health_alerts', {
        p_limit: 100,
        p_unacknowledged_only: filter === 'unack',
      });
      if (error) throw error;
      return (data ?? []) as AlertRow[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel('doctor-health-alerts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'health_alerts' },
        () => {
          qc.invalidateQueries({ queryKey: ['doctor-alerts'] });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctor-alerts'] }),
  });

  // Derive the unique patient list from the alerts feed itself — no extra
  // round-trip. If a doctor has patients with zero alerts, they won't show
  // up here, which is fine (no filter chip = nothing to filter to).
  const patients = useMemo(() => {
    const a = alerts.data ?? [];
    const map = new Map<string, string>();
    for (const x of a) {
      if (!map.has(x.elder_id)) map.set(x.elder_id, x.elder_name ?? 'Patient');
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [alerts.data]);

  const visible = useMemo(() => {
    const a = alerts.data ?? [];
    return patientFilter ? a.filter((x) => x.elder_id === patientFilter) : a;
  }, [alerts.data, patientFilter]);

  const counts = useMemo(() => {
    const a = alerts.data ?? [];
    return {
      critical: a.filter((x) => x.severity === 'critical' && !x.acknowledged_at).length,
    };
  }, [alerts.data]);

  return (
    <FieldScreen>
      <SubHeader
        title="Patient alerts"
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

      {patients.length > 1 ? (
        <ScrollView
          horizontal
          contentContainerStyle={styles.patientFilterRow}
          showsHorizontalScrollIndicator={false}
        >
          <PatientChip
            label="All patients"
            active={patientFilter === null}
            onPress={() => setPatientFilter(null)}
          />
          {patients.map((p) => (
            <PatientChip
              key={p.id}
              label={p.name}
              active={patientFilter === p.id}
              onPress={() => setPatientFilter(p.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <AlertCardRow
            alert={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onAcknowledge={() => ack.mutate(item.id)}
            onOpenPatient={() =>
              router.push({
                pathname: '/(doctor)/patient/[id]',
                params: { id: item.elder_id },
              })
            }
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

/**
 * Per-patient chip. Separate from FilterChips because the patient set is
 * dynamic and scrolls horizontally, so it can't use the fixed-items API.
 */
function PatientChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function AlertCardRow({
  alert,
  expanded,
  onToggle,
  onAcknowledge,
  onOpenPatient,
  ackBusy,
}: {
  alert: AlertRow;
  expanded: boolean;
  onToggle: () => void;
  onAcknowledge: () => void;
  onOpenPatient: () => void;
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
          <Text style={styles.kindLabel}>{kindLabel(alert.kind)}</Text>
        </View>
        <View style={styles.rowMeta}>
          <Text style={styles.metaText}>
            {isolate(alert.elder_name) || 'Patient'} · {ago(alert.created_at)}
          </Text>
          {ackd ? <Text style={styles.ackedText}>Acknowledged</Text> : null}
        </View>
        {bandAlertNote(alert) ? <Text style={styles.bandNote}>{bandAlertNote(alert)}</Text> : null}
        {bandAlertText(alert) ? (
          <Text style={styles.explanation} numberOfLines={expanded ? undefined : 2}>
            {bandAlertText(alert)}
          </Text>
        ) : null}
        {alert.kind === 'rafiq' ? <RafiqLink elderId={alert.elder_id} /> : null}
        {expanded ? (
          <View style={{ gap: space.s }}>
            {!ackd ? (
              <Button label="Acknowledge" onPress={onAcknowledge} loading={ackBusy} />
            ) : null}
            <Button label="Open patient file" variant="secondary" onPress={onOpenPatient} />
          </View>
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
  filterRow: { paddingHorizontal: space.m, paddingBottom: space.s },
  patientFilterRow: {
    gap: space.s,
    paddingHorizontal: space.m,
    paddingBottom: space.m,
  },
  // Patient chips read as outlined pills on the indigo field, filling white
  // when selected — same treatment as FilterChips.
  chip: {
    paddingHorizontal: 14,
    paddingVertical: space.s,
    borderRadius: radius.s,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  chipActive: { backgroundColor: colors.surface, borderColor: colors.surface },
  chipText: { ...type.cardBody, color: colors.textInverse },
  chipTextActive: { color: colors.primary },
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
