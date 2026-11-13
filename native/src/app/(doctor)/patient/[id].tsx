// Doctor's per-patient view. Shows the latest vitals snapshot and the most
// Rafiq trends (Trends tab). Doctors are explicitly blocked from location data
// at the RLS layer, so this screen does not query any location-bearing
// table — defense in depth.
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from '@/navigation/router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { FieldCard, FieldScreen, FilterChips, SubHeader } from '@/components/dashboard';
import { TrendsPanel } from '@/components/trends/TrendsPanel';
import { BandStatusCard } from '@/components/band/BandStatusCard';
import { SourceTag } from '@/components/band/SourceTag';
import { bandAlertNote, bandKindLabel, isBandReading, useBandStepsToday } from '@/lib/band';
import { supabase } from '@/lib/supabase';
import { listPrescriptions } from '@/lib/prescriptions';
import { openConversationWith } from '@/lib/messages';
import { colors, space, type } from '@/theme/tokens';
import { formatDate, formatDateTime, formatNumber, isolate, t } from '@/lib/i18n';

type Vital = {
  id: number;
  kind: string;
  value_numeric: number | null;
  value_systolic: number | null;
  value_diastolic: number | null;
  unit: string | null;
  captured_at: string;
  source?: string | null;
  quality?: number | null;
};

type PatientAlert = {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  payload: Record<string, unknown> | null;
  acknowledged_at: string | null;
  created_at: string;
};

type Visit = {
  id: string;
  visit_date: string;
  symptoms: string | null;
  notes: string | null;
};

type Profile = {
  id: string;
  display_name: string;
  date_of_birth: string | null;
  gender: string | null;
};

export default function PatientDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<'overview' | 'trends'>('overview');

  const profile = useQuery<Profile | null>({
    queryKey: ['patient_profile', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, date_of_birth, gender')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });

  // The latest reading of each kind. (A band sends a reading every few
  // minutes, so "the 6 newest rows" would all be band rows of one kind.)
  const vitals = useQuery<Vital[]>({
    queryKey: ['latest_vitals', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('latest_vitals_summary', { p_elder: id });
      if (error) throw error;
      return ((data ?? []) as Vital[])
        // Movement counts only feed night restlessness in Trend Watch.
        .filter((v) => v.kind !== 'movement')
        .sort((a, b) => b.captured_at.localeCompare(a.captured_at));
    },
  });
  const bandSteps = useBandStepsToday(
    id,
    isBandReading(vitals.data?.find((v) => v.kind === 'steps')),
  );

  const alerts = useQuery<PatientAlert[]>({
    queryKey: ['patient_alerts', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('health_alerts')
        .select('id, kind, severity, payload, acknowledged_at, created_at')
        .eq('elder_id', id)
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as PatientAlert[];
    },
  });

  const visits = useQuery<Visit[]>({
    queryKey: ['doctor_visits', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('doctor_visits')
        .select('id, visit_date, symptoms, notes')
        .eq('elder_id', id)
        .order('visit_date', { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Visit[];
    },
  });

  const prescriptions = useQuery({
    queryKey: ['prescriptions', id],
    enabled: !!id,
    queryFn: () => listPrescriptions(id!),
  });

  // Refresh the prescription list when returning from the prescribe form.
  useFocusEffect(
    useCallback(() => {
      if (id) prescriptions.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]),
  );

  return (
    <FieldScreen>
      <SubHeader title={isolate(profile.data?.display_name) || 'Patient'} />
      <View style={styles.tabs}>
        <FilterChips<'overview' | 'trends'>
          items={[
            { key: 'overview', label: t('trends.tab.overview'), icon: 'clipboard' },
            { key: 'trends', label: t('trends.tab.trends'), icon: 'activity' },
          ]}
          active={tab}
          onSelect={setTab}
        />
      </View>
      {tab === 'trends' && id ? (
        <ScrollView contentContainerStyle={styles.body}>
          <TrendsPanel elderId={id} elderName={profile.data?.display_name ?? ''} doctor />
        </ScrollView>
      ) : (
      <ScrollView contentContainerStyle={styles.body}>
        {profile.data?.date_of_birth ? (
          <Text style={styles.subtitle}>
            Date of birth: {formatDate(profile.data.date_of_birth)}
          </Text>
        ) : null}

        <Button
          label={t('messages.message')}
          variant="secondary"
          onPress={async () => {
            if (!id) return;
            const conv = await openConversationWith(id);
            router.push({ pathname: '/messages/[id]', params: { id: conv } });
          }}
        />

        {id ? (
          <Button
            label="Rafiq: readings against their normal"
            variant="secondary"
            onPress={() => router.push({ pathname: '/rafiq', params: { elderId: id } })}
          />
        ) : null}

        {id ? <BandStatusCard elderId={id} elderName={profile.data?.display_name ?? ''} /> : null}

        <Section title="Latest readings">
          {vitals.isLoading ? (
            <Text style={styles.muted}>Loading...</Text>
          ) : vitals.data?.length ? (
            vitals.data.map((v) => {
              const bandStepsTotal = v.kind === 'steps' && isBandReading(v);
              return (
                <FieldCard key={v.id} style={styles.row}>
                  <View style={styles.rowHeader}>
                    <Text style={styles.rowKind}>
                      {bandStepsTotal ? 'Steps today' : kindLabel(v.kind)}
                    </Text>
                    <SourceTag reading={v} />
                  </View>
                  <Text style={styles.rowValue}>
                    {bandStepsTotal ? formatNumber(bandSteps.data ?? 0) : formatVital(v)}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {formatDateTime(v.captured_at)}
                  </Text>
                </FieldCard>
              );
            })
          ) : (
            <Text style={styles.muted}>No recent readings</Text>
          )}
        </Section>

        <Section title="Recent alerts">
          {alerts.isLoading ? (
            <Text style={styles.muted}>Loading...</Text>
          ) : alerts.data?.length ? (
            <>
              {alerts.data.map((a) => (
                <FieldCard key={a.id} style={[styles.row, alertBorder(a.severity)]}>
                  <View style={styles.rowHeader}>
                    <Text style={[styles.severity, alertSeverityColor(a.severity)]}>
                      {alertKindLabel(a.kind)}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {formatDateTime(a.created_at)}
                    </Text>
                  </View>
                  {bandAlertNote(a) ? (
                    <Text style={styles.rowMeta}>{bandAlertNote(a)}</Text>
                  ) : null}
                  {a.acknowledged_at ? (
                    <Text style={styles.muted}>Acknowledged</Text>
                  ) : (
                    <Text style={styles.rowKind}>Not acknowledged</Text>
                  )}
                </FieldCard>
              ))}
              <Button
                label="Open all alerts"
                variant="ghostInverse"
                onPress={() => router.push('/(doctor)/alerts')}
              />
            </>
          ) : (
            <Text style={styles.muted}>No alerts recorded</Text>
          )}
        </Section>

        <Section title="Prescriptions">
          <Button
            label="+ Prescribe"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/(doctor)/prescribe',
                params: { elderId: id, elderName: profile.data?.display_name ?? '' },
              })
            }
          />
          {prescriptions.isLoading ? (
            <Text style={styles.muted}>Loading...</Text>
          ) : prescriptions.data?.length ? (
            prescriptions.data.map((p) => (
              <FieldCard key={p.id} style={styles.row}>
                <Text style={styles.rowValue}>{p.medication_name}</Text>
                {p.dosage ? <Text style={styles.rowKind}>{p.dosage}</Text> : null}
                {p.instructions ? (
                  <Text style={styles.rowMeta}>{p.instructions}</Text>
                ) : null}
                <Text style={styles.rowMeta}>
                  {formatDate(p.prescribed_at)}
                </Text>
              </FieldCard>
            ))
          ) : (
            <Text style={styles.muted}>No prescriptions yet</Text>
          )}
        </Section>

        <Section title="Visits">
          <Button
            label="+ New visit"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/(doctor)/visit/new',
                params: { elderId: id },
              })
            }
          />
          {visits.isLoading ? (
            <Text style={styles.muted}>Loading...</Text>
          ) : visits.data?.length ? (
            visits.data.map((v) => (
              <Pressable
                key={v.id}
                onPress={() =>
                  router.push({
                    pathname: '/(doctor)/visit/[visitId]',
                    params: { visitId: v.id },
                  })
                }
              >
                <FieldCard style={styles.row}>
                  <Text style={styles.rowKind}>{v.visit_date}</Text>
                  {v.symptoms ? (
                    <Text style={styles.rowValue} numberOfLines={2}>
                      {v.symptoms}
                    </Text>
                  ) : null}
                  {v.notes ? (
                    <Text style={styles.rowMeta} numberOfLines={2}>
                      {v.notes}
                    </Text>
                  ) : null}
                </FieldCard>
              </Pressable>
            ))
          ) : (
            <Text style={styles.muted}>No visits recorded</Text>
          )}
        </Section>

      </ScrollView>
      )}
    </FieldScreen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={{ gap: space.m }}>{children}</View>
    </View>
  );
}

function kindLabel(k: string) {
  switch (k) {
    case 'heart_rate':     return 'Heart rate';
    case 'blood_pressure': return 'Blood pressure';
    case 'spo2':           return 'Oxygen';
    case 'temperature':    return 'Temperature';
    case 'weight':         return 'Weight';
    case 'sleep':          return 'Sleep';
    case 'steps':          return 'Steps';
    case 'skin_temperature': return 'Skin temperature';
    case 'glucose':        return 'Blood sugar';
    default:               return k;
  }
}

function formatVital(v: Vital) {
  if (v.kind === 'blood_pressure') {
    return `${v.value_systolic ?? '–'} / ${v.value_diastolic ?? '–'} ${v.unit ?? ''}`.trim();
  }
  return `${v.value_numeric ?? '–'} ${v.unit ?? ''}`.trim();
}

// Per-patient alert section helpers. Mirrors the labels used in the global
// alerts screen so doctors see consistent terminology everywhere.
function alertKindLabel(k: string): string {
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
    case 'trend': return t('alerts.kind.trend');
    default: return bandKindLabel(k) ?? k;
  }
}

function alertBorder(s: PatientAlert['severity']) {
  if (s === 'critical') return { borderRightWidth: 4, borderRightColor: colors.alertCritical };
  if (s === 'warning') return { borderRightWidth: 4, borderRightColor: colors.alertWarning };
  return { borderRightWidth: 4, borderRightColor: colors.alertInfo };
}

function alertSeverityColor(s: PatientAlert['severity']) {
  if (s === 'critical') return { color: colors.alertCritical };
  if (s === 'warning') return { color: colors.alertWarning };
  return { color: colors.alertInfo };
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: space.m, paddingBottom: space.m },
  body: { paddingHorizontal: space.m, gap: space.l, paddingBottom: space.xxl },
  // Text directly on the indigo field, so it reads in the on-primary tints
  // rather than the dark-on-white scale used inside cards.
  subtitle: { ...type.body, color: colors.onPrimary, textAlign: 'left' },
  section: { gap: space.m },
  sectionTitle: { ...type.title, color: colors.textInverse, textAlign: 'left' },
  row: { gap: space.xs },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowKind: { ...type.subtitle, color: colors.textSecondary, textAlign: 'left' },
  rowValue: { ...type.title, color: colors.textPrimary, textAlign: 'left' },
  rowMeta: { ...type.caption, color: colors.textSecondary },
  severity: { ...type.caption, fontWeight: '700' },
  muted: { ...type.body, color: colors.onPrimaryMuted, textAlign: 'left' },
});
