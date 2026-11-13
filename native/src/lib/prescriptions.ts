// Prescriptions API. RLS does the gating:
//   • SELECT — elder + anyone with health perm (family, doctor)
//   • INSERT — doctors only, prescribed_by must equal the caller
//   • UPDATE — only the prescribing doctor
// So the client just inserts/selects; the database enforces who's allowed.
import { supabase } from '@/lib/supabase';

export type Prescription = {
  id: string;
  elder_id: string;
  visit_id: string | null;
  prescribed_by: string | null;
  medication_name: string;
  dosage: string | null;
  instructions: string | null;
  prescribed_at: string;
  expires_at: string | null;
  // joined when listed
  prescriber?: { display_name: string | null } | null;
};

export async function listPrescriptions(elderId: string): Promise<Prescription[]> {
  const { data, error } = await supabase
    .from('prescriptions')
    .select(
      'id, elder_id, visit_id, prescribed_by, medication_name, dosage, instructions, prescribed_at, expires_at, prescriber:profiles!prescriptions_prescribed_by_fkey(display_name)',
    )
    .eq('elder_id', elderId)
    .order('prescribed_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as Prescription[];
}

export async function createPrescription(input: {
  elderId: string;
  medicationName: string;
  dosage?: string | null;
  instructions?: string | null;
  visitId?: string | null;
  expiresAt?: string | null;
}): Promise<Prescription> {
  const { data: userRes } = await supabase.auth.getUser();
  const me = userRes.user?.id;
  if (!me) throw new Error('not_authenticated');

  const { data, error } = await supabase
    .from('prescriptions')
    .insert({
      elder_id: input.elderId,
      prescribed_by: me,
      medication_name: input.medicationName.trim(),
      dosage: input.dosage?.trim() || null,
      instructions: input.instructions?.trim() || null,
      visit_id: input.visitId ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Prescription;
}
