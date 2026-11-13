// Vitals quick-entry. Heart rate, blood pressure (sys/dia), SpO2, temperature.
// Calls record_vital RPC; the maybe_emit_vital_alert trigger inserts a
// health_alerts row when thresholds are crossed, which fires the AI assessment
// + push fanout pipeline from Step 10.
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from '@/navigation/router';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { FieldCard, FieldScreen, SubHeader } from '@/components/dashboard';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { colors, radius, space, touch, type } from '@/theme/tokens';

type Kind = 'heart_rate' | 'blood_pressure' | 'spo2' | 'temperature';

const KIND_LABELS: Record<Kind, { label: string; unit: string }> = {
  heart_rate:     { label: 'Heart rate',     unit: 'bpm' },
  blood_pressure: { label: 'Blood pressure', unit: 'mmHg' },
  spo2:           { label: 'Oxygen',         unit: '%' },
  temperature:    { label: 'Temperature',    unit: '°C' },
};

export default function VitalsEntry() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  const [kind, setKind] = useState<Kind>('heart_rate');
  const [v, setV] = useState('');
  const [vSys, setVSys] = useState('');
  const [vDia, setVDia] = useState('');

  const submit = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('no user');
      const args: Record<string, unknown> = {
        p_elder: userId,
        p_kind: kind,
      };
      if (kind === 'blood_pressure') {
        args.p_value_systolic = Number(vSys);
        args.p_value_diastolic = Number(vDia);
        args.p_unit = 'mmHg';
      } else {
        args.p_value_numeric = Number(v);
        args.p_unit = KIND_LABELS[kind].unit;
      }
      const { error } = await supabase.rpc('record_vital', args);
      if (error) throw error;
    },
    onSuccess: () => router.back(),
  });

  const valid =
    kind === 'blood_pressure'
      ? Number(vSys) > 0 && Number(vDia) > 0
      : Number(v) > 0;

  return (
    <FieldScreen>
      <SubHeader title="Add a reading" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.kindRow}>
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => {
            const active = kind === k;
            return (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {KIND_LABELS[k].label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <FieldCard style={styles.entry}>
          {kind === 'blood_pressure' ? (
            <>
              <Field label="Systolic" unit="mmHg" value={vSys} onChange={setVSys} />
              <Field label="Diastolic" unit="mmHg" value={vDia} onChange={setVDia} />
            </>
          ) : (
          <Field
            label={KIND_LABELS[kind].label}
            unit={KIND_LABELS[kind].unit}
            value={v}
            onChange={setV}
          />
        )}
        </FieldCard>

        {submit.isError ? (
          <Text style={styles.error}>{(submit.error as Error).message}</Text>
        ) : null}

        <View style={styles.footer}>
          <Button
            label="Save reading"
            variant="secondary"
            onPress={() => submit.mutate()}
            disabled={!valid || submit.isPending}
            loading={submit.isPending}
          />
          {submit.isPending ? <ActivityIndicator color={colors.textInverse} /> : null}
        </View>
      </ScrollView>
    </FieldScreen>
  );
}

function Field({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
          style={styles.input}
          textAlign="center"
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.m, paddingBottom: space.xxl },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginBottom: space.l },
  // Outlined on the indigo field, filling white when selected — the same chip
  // treatment as FilterChips so the whole app reads as one surface.
  chip: {
    paddingHorizontal: 14,
    paddingVertical: space.s,
    borderRadius: radius.s,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  chipActive: { backgroundColor: colors.surface, borderColor: colors.surface },
  chipLabel: { ...type.cardBody, color: colors.textInverse },
  chipLabelActive: { color: colors.primary },
  entry: { gap: space.l },
  field: { gap: space.s },
  fieldLabel: { ...type.subtitle, color: colors.textSecondary, textAlign: 'left' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.xl,
    paddingHorizontal: space.l,
  },
  input: { flex: 1, minHeight: touch.elderMin, ...type.title, color: colors.textPrimary },
  unit: { ...type.body, color: colors.textSecondary },
  error: { ...type.body, color: colors.textInverse, textAlign: 'left', marginTop: space.m },
  footer: { marginTop: space.xl, gap: space.m },
});
