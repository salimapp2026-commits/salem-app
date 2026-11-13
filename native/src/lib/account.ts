// Account data export + deletion helpers. Wrap the SECURITY DEFINER RPCs from
// the step18a migration and handle the platform-specific "download the export
// file" mechanics.
//
// Export download:
//   write the JSON to the cache folder (react-native-fs) and open the share
//   sheet (react-native-share).
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { supabase } from '@/lib/supabase';

export type DeletionRequest = {
  id: string;
  user_id: string;
  email: string | null;
  reason: string | null;
  status: 'pending' | 'cancelled' | 'completed';
  requested_at: string;
  scheduled_for: string;
  finalized_at: string | null;
};

// Unwrap a Postgres composite result into a real row or null.
//
// Two shapes have to be handled, and getting this wrong is user-visible: these
// RPCs return a composite, and when there is NO matching row PostgREST renders
// it as an object with every field null ({id: null, ...}) rather than null.
// That object is truthy, which made the settings screen tell every user "your
// account is scheduled for deletion" dated 1/1/1970 (from `new Date(null)`).
// A row without an id is not a row.
function firstRow<T extends { id?: string | null }>(data: unknown): T | null {
  const row = Array.isArray(data) ? (data[0] as T | undefined) : (data as T | null);
  if (!row || !row.id) return null;
  return row;
}

export async function fetchDeletionStatus(): Promise<DeletionRequest | null> {
  const { data, error } = await supabase.rpc('account_deletion_status');
  if (error) throw error;
  return firstRow<DeletionRequest>(data);
}

export async function requestAccountDeletion(reason?: string): Promise<DeletionRequest> {
  const { data, error } = await supabase.rpc('request_account_deletion', {
    p_reason: reason ?? null,
  });
  if (error) throw error;
  const row = firstRow<DeletionRequest>(data);
  if (!row) throw new Error('deletion_request_failed');
  return row;
}

export async function cancelAccountDeletion(): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancel_account_deletion');
  if (error) throw error;
  return Boolean(data);
}

// Fetch the full export blob and hand it to the user as a downloadable
// salem-data-<date>.json file.
export async function downloadAccountData(): Promise<void> {
  const { data, error } = await supabase.rpc('export_account_data');
  if (error) throw error;

  const json = JSON.stringify(data, null, 2);
  const filename = `salem-data-${new Date().toISOString().slice(0, 10)}.json`;

  // Write to the cache folder and open the share sheet (Save to Files, Mail…).
  const path = `${RNFS.CachesDirectoryPath}/${filename}`;
  await RNFS.writeFile(path, json, 'utf8');
  await Share.open({
    url: `file://${path}`,
    type: 'application/json',
    filename,
    failOnCancel: false,
  });
}
