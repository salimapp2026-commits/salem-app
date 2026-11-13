// View one visit. Read-only for now — editing comes later. Loads visit row +
// attachment metadata, then signs the storage URLs (the bucket is private,
// so direct URLs would 403). RLS already gates which doctors can read.
import { useMemo } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from '@/navigation/router';
import { useQuery } from '@tanstack/react-query';
import { FieldScreen, SubHeader } from '@/components/dashboard';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { supabase } from '@/lib/supabase';
import { colors, radius, space, type } from '@/theme/tokens';
import { isolate } from '@/lib/i18n';

type Visit = {
  id: string;
  elder_id: string;
  doctor_id: string | null;
  doctor_name: string;
  visit_date: string;
  symptoms: string | null;
  notes: string | null;
  created_at: string;
};

type Attachment = {
  id: string;
  visit_id: string;
  storage_path: string;
  kind: 'image' | 'pdf' | 'other';
  created_at: string;
};

type SignedAttachment = Attachment & { url: string | null };

const SIGN_TTL = 60 * 60; // 1 hour signed URLs

export default function VisitDetail() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const router = useRouter();

  const visit = useQuery<Visit | null>({
    queryKey: ['visit', visitId],
    enabled: !!visitId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('doctor_visits')
        .select('*')
        .eq('id', visitId)
        .maybeSingle();
      if (error) throw error;
      return data as Visit | null;
    },
  });

  const attachments = useQuery<SignedAttachment[]>({
    queryKey: ['visit-attachments', visitId],
    enabled: !!visitId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visit_attachments')
        .select('*')
        .eq('visit_id', visitId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Attachment[];
      // Sign each path so the private bucket is accessible from the client.
      const signed = await Promise.all(
        rows.map(async (a) => {
          const { data: s } = await supabase.storage
            .from('visit-attachments')
            .createSignedUrl(a.storage_path, SIGN_TTL);
          return { ...a, url: s?.signedUrl ?? null };
        }),
      );
      return signed;
    },
  });

  const subtitle = useMemo(() => {
    if (!visit.data) return '';
    const dr = visit.data.doctor_name?.trim();
    return dr ? `Dr. ${isolate(dr)}` : 'Visit';
  }, [visit.data]);

  return (
    <FieldScreen>
      <SubHeader title={subtitle} />
      <ScrollView contentContainerStyle={styles.scrollBody}>

      {visit.isLoading || !visit.data ? (
        <Card>
          <Text style={styles.muted}>Loading...</Text>
        </Card>
      ) : (
        <Card>
          <Text style={styles.fieldLabel}>Date</Text>
          <Text style={styles.value}>{visit.data.visit_date}</Text>
          {visit.data.symptoms ? (
            <>
              <Text style={styles.fieldLabel}>Symptoms</Text>
              <Text style={styles.value}>{visit.data.symptoms}</Text>
            </>
          ) : null}
          {visit.data.notes ? (
            <>
              <Text style={styles.fieldLabel}>Notes</Text>
              <Text style={styles.value}>{visit.data.notes}</Text>
            </>
          ) : null}
        </Card>
      )}

      <Card>
        <Text style={styles.sectionTitle}>Attachments</Text>
        {attachments.isLoading ? (
          <Text style={styles.muted}>Loading attachments...</Text>
        ) : attachments.data?.length ? (
          <View style={styles.grid}>
            {attachments.data.map((a) => (
              <AttachmentTile key={a.id} a={a} />
            ))}
          </View>
        ) : (
          <Text style={styles.muted}>No attachments</Text>
        )}
      </Card>

      {visit.data ? (
        <Button
          label="New visit for this patient"
          variant="ghostInverse"
          onPress={() =>
            router.push({
              pathname: '/(doctor)/visit/new',
              params: { elderId: visit.data!.elder_id },
            })
          }
        />
      ) : null}
      </ScrollView>
    </FieldScreen>
  );
}

function AttachmentTile({ a }: { a: SignedAttachment }) {
  if (!a.url) {
    return (
      <View style={styles.tile}>
        <Text style={styles.muted}>Could not load attachment</Text>
      </View>
    );
  }
  if (a.kind === 'image') {
    return (
      <Pressable
        onPress={() => a.url && Linking.openURL(a.url)}
        style={styles.tile}
      >
        <Image source={{ uri: a.url }} style={styles.thumb} resizeMode="cover" />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={() => a.url && Linking.openURL(a.url)}
      style={[styles.tile, styles.fileTile]}
    >
      <Text style={styles.fileIcon}>📄</Text>
      <Text style={styles.fileLabel}>{a.kind.toUpperCase()}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrollBody: { paddingHorizontal: space.m, paddingBottom: space.xxl },
  sectionTitle: { ...type.subtitle, color: colors.textPrimary, marginBottom: space.m, textAlign: 'left' },
  fieldLabel: { ...type.caption, color: colors.textSecondary, textAlign: 'left', marginTop: space.m },
  value: { ...type.body, color: colors.textPrimary, textAlign: 'left' },
  muted: { ...type.body, color: colors.textSecondary, textAlign: 'left' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m },
  tile: {
    width: 144,
    height: 144,
    borderRadius: radius.m,
    overflow: 'hidden',
    backgroundColor: colors.cream,
  },
  thumb: { width: '100%', height: '100%' },
  fileTile: { alignItems: 'center', justifyContent: 'center' },
  fileIcon: { fontSize: 40 },
  fileLabel: { ...type.caption, color: colors.textSecondary, marginTop: space.s },
});
