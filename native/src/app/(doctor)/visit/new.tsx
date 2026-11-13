// New visit form. Doctors fill it from inside a patient's drilldown — the
// elderId is passed in via the URL query, the doctor_id is the current user.
//
// Flow:
//   1. Insert into doctor_visits (RLS allows because the doctor has health
//      perm on the elder via care_circle_members).
//   2. For each picked photo, upload to storage at
//      `<elder_id>/<visit_id>/<uuid>.<ext>`. The visit-attachments bucket
//      policy gates on `split_part(name, '/', 1) = elder_id` + has_perm.
//   3. Insert a visit_attachments row per uploaded file.
//
// On the web the picker uses an <input type="file"> via expo-image-picker
// shim; on native it opens the photos sheet. Same call site either way.
import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from '@/navigation/router';
import { pickImages, readFileBytes } from '@/lib/pickImages';
import { FieldScreen, SubHeader } from '@/components/dashboard';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { colors, radius, space, touch, type } from '@/theme/tokens';

type PickedAsset = {
  uri: string;
  mimeType: string;
  fileName: string;
};

export default function NewVisit() {
  const { elderId } = useLocalSearchParams<{ elderId?: string }>();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);

  const [visitDate, setVisitDate] = useState(() => isoDate(new Date()));
  const [symptoms, setSymptoms] = useState('');
  const [notes, setNotes] = useState('');
  const [assets, setAssets] = useState<PickedAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    const next: PickedAsset[] = await pickImages({ multiple: true });
    if (next.length === 0) return;
    setAssets((prev) => [...prev, ...next]);
  };

  const removeAsset = (idx: number) =>
    setAssets((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    setError(null);
    if (!elderId) {
      setError('elderId is missing');
      return;
    }
    if (!visitDate) {
      setError('Date is required');
      return;
    }
    setBusy(true);

    try {
      // 1. Insert the visit row
      setProgressMsg('Saving visit...');
      const { data: visit, error: insErr } = await supabase
        .from('doctor_visits')
        .insert({
          elder_id: elderId,
          doctor_id: userId,
          doctor_name: '',  // populated by trigger from profile, or left blank
          visit_date: visitDate,
          symptoms: symptoms.trim() || null,
          notes: notes.trim() || null,
          created_by: userId,
        })
        .select('id')
        .single();
      if (insErr) throw insErr;
      const visitId = (visit as { id: string }).id;

      // 2. Upload each asset, then insert visit_attachments row
      for (let i = 0; i < assets.length; i++) {
        const a = assets[i];
        setProgressMsg(`Uploading attachment ${i + 1} of ${assets.length}...`);
        const ext = a.fileName.split('.').pop()?.toLowerCase() || 'jpg';
        const safeExt = ['jpg', 'jpeg', 'png', 'pdf', 'heic', 'webp'].includes(ext)
          ? ext
          : 'jpg';
        const path = `${elderId}/${visitId}/${cryptoRandom()}.${safeExt}`;

        // Fetch the local URI as a Blob (works on web + native via fetch).
        const bytes = await readFileBytes(a.uri);

        const { error: upErr } = await supabase.storage
          .from('visit-attachments')
          .upload(path, bytes, {
            contentType: a.mimeType,
            upsert: false,
          });
        if (upErr) throw upErr;

        const { error: aErr } = await supabase.from('visit_attachments').insert({
          visit_id: visitId,
          elder_id: elderId,
          storage_path: path,
          kind: safeExt === 'pdf' ? 'pdf' : 'image',
        });
        if (aErr) throw aErr;
      }

      Alert.alert('Visit saved');
      router.replace({ pathname: '/(doctor)/visit/[visitId]', params: { visitId } });
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
      setProgressMsg(null);
    }
  };

  return (
    <FieldScreen>
      <SubHeader title="New visit" />
      <ScrollView contentContainerStyle={styles.scrollBody}>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ gap: space.l }}
      >
        <Card>
          <Field
            label="Date (YYYY-MM-DD)"
            value={visitDate}
            onChangeText={setVisitDate}
            placeholder="2026-05-08"
          />
          <Field
            label="Symptoms"
            value={symptoms}
            onChangeText={setSymptoms}
            multiline
            numberOfLines={3}
          />
          <Field
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={5}
          />
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Attachments</Text>
          <Button label="Add photos" variant="secondary" onPress={pick} />
          {assets.length > 0 ? (
            <ScrollView
              horizontal
              style={styles.thumbStrip}
              contentContainerStyle={{ gap: space.s }}
              showsHorizontalScrollIndicator={false}
            >
              {assets.map((a, i) => (
                <Pressable key={a.uri + i} onPress={() => removeAsset(i)}>
                  <Image source={{ uri: a.uri }} style={styles.thumb} />
                  <Text style={styles.removeLabel}>Remove</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.muted}>No attachments yet</Text>
          )}
        </Card>

        {error ? <Text style={styles.onFieldError}>{error}</Text> : null}
        {progressMsg ? <Text style={styles.onFieldMuted}>{progressMsg}</Text> : null}

        <Button label="Save visit" variant="secondary" onPress={submit} loading={busy} />
      </KeyboardAvoidingView>
      </ScrollView>
    </FieldScreen>
  );
}

function Field(
  props: React.ComponentProps<typeof TextInput> & { label: string },
) {
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

function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function cryptoRandom(): string {
  // crypto.randomUUID is available on web and modern RN runtimes (Hermes 0.74+).
  // Fall back to a Math-based random for very old runtimes.
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    return c?.randomUUID?.() ?? fallbackUuid();
  } catch {
    return fallbackUuid();
  }
}

function fallbackUuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function toMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

const styles = StyleSheet.create({
  scrollBody: { paddingHorizontal: space.m, paddingBottom: space.xxl },
  // Status text below the cards sits directly on the indigo field, so it
  // needs the inverse scale — `error` / `muted` are for inside the cards.
  onFieldError: { ...type.body, color: colors.textInverse, textAlign: 'left' },
  onFieldMuted: { ...type.body, color: colors.onPrimaryMuted, textAlign: 'left' },
  sectionTitle: { ...type.subtitle, color: colors.textPrimary, marginBottom: space.m, textAlign: 'left' },
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
  inputMulti: { textAlignVertical: 'top', minHeight: 100 },
  thumbStrip: { marginTop: space.m },
  thumb: { width: 96, height: 96, borderRadius: radius.m, backgroundColor: colors.cream },
  removeLabel: { ...type.caption, color: colors.alertCritical, textAlign: 'center', marginTop: 4 },
  muted: { ...type.body, color: colors.textSecondary, textAlign: 'left' },
  error: { ...type.body, color: colors.alertCritical, textAlign: 'left' },
});
