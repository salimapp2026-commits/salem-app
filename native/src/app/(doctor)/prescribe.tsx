// Doctor prescribe form. Reached from a patient's drilldown (elderId passed
// via query). RLS only lets a doctor with health perm insert, with
// prescribed_by = self, so the insert is safe even though it's a direct call.
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from '@/navigation/router';
import { FieldScreen, SubHeader } from '@/components/dashboard';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { createPrescription } from '@/lib/prescriptions';
import { colors, radius, space, touch, type } from '@/theme/tokens';
import { isolate } from '@/lib/i18n';

export default function Prescribe() {
  const { elderId, elderName } = useLocalSearchParams<{ elderId?: string; elderName?: string }>();
  const router = useRouter();

  const [med, setMed] = useState('');
  const [dosage, setDosage] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!elderId) {
      setError('Patient id is missing');
      return;
    }
    if (!med.trim()) {
      setError('Medication name is required');
      return;
    }
    setBusy(true);
    try {
      await createPrescription({
        elderId,
        medicationName: med,
        dosage,
        instructions,
      });
      Alert.alert('Prescription saved');
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FieldScreen>
      <SubHeader title="Prescribe" />
      <ScrollView contentContainerStyle={styles.scrollBody}>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ gap: space.l }}
      >
        {elderName ? (
          <Text style={styles.forWhom}>For: {isolate(elderName)}</Text>
        ) : null}

        <Card>
          <Field label="Medication" value={med} onChangeText={setMed} placeholder="e.g. Panadol" />
          <Field
            label="Dosage"
            value={dosage}
            onChangeText={setDosage}
            placeholder="e.g. one tablet twice daily"
          />
          <Field
            label="Instructions (optional)"
            value={instructions}
            onChangeText={setInstructions}
            multiline
            numberOfLines={4}
            placeholder="e.g. after food, for one week"
          />
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Save prescription" variant="secondary" onPress={submit} loading={busy} />
      </KeyboardAvoidingView>
      </ScrollView>
    </FieldScreen>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        style={[styles.input, props.multiline ? styles.inputMulti : null]}
        placeholderTextColor={colors.textSecondary}
        textAlign="left"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrollBody: { paddingHorizontal: space.m, paddingBottom: space.xxl },
  // On the indigo field, so it uses the on-primary tints.
  forWhom: { ...type.body, color: colors.onPrimary, textAlign: 'left' },
  field: { gap: space.s, marginBottom: space.m },
  fieldLabel: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
  input: {
    minHeight: touch.elderMin,
    backgroundColor: colors.cream,
    borderRadius: radius.xl,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    ...type.body,
    color: colors.textPrimary,
  },
  inputMulti: { textAlignVertical: 'top', minHeight: 96 },
  error: { ...type.body, color: colors.textInverse, textAlign: 'left' },
});
