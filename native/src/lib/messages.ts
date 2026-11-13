// In-app messaging between the elder, their caregivers and their doctor.
// Restored 2026-10-14 (it was removed from the app on 2026-09-25; the database
// side never went away). Only Agora in-app calling stays removed.
//
// Who may talk to whom is decided in the database:
//   • message_contacts() / get_or_create_direct_conversation() — the elder and
//     everyone active in their circle, and circle members with each other
//   • RLS on messages — only participants read or send
//   • joining a conversation only through those functions (step29a)
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

export type MessageContact = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  relation: 'elder' | 'primary_caretaker' | 'family' | 'doctor' | string;
  elder_id: string;
  elder_name: string | null;
};

export function useMessageContacts(enabled = true) {
  const userId = useAuthStore((st) => st.user?.id);
  return useQuery<MessageContact[]>({
    queryKey: ['message_contacts', userId],
    enabled: enabled && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('message_contacts');
      if (error) throw error;
      return (data ?? []) as MessageContact[];
    },
  });
}

/** Find or create the 1:1 conversation with someone in my circle(s). */
export async function openConversationWith(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_direct_conversation', {
    p_other_user: otherUserId,
  });
  if (error) throw error;
  if (!data) throw new Error('conversation_create_failed');
  return data as string;
}

/** Write to a circle member in-app: find or create the thread, then send. */
export async function sendInAppMessage(otherUserId: string, text: string): Promise<string> {
  const { data: userRes } = await supabase.auth.getUser();
  const me = userRes.user?.id;
  if (!me) throw new Error('not_authenticated');
  const convId = await openConversationWith(otherUserId);
  const { error } = await supabase.from('messages').insert({
    conversation_id: convId,
    sender_id: me,
    kind: 'text',
    body_text: text,
  });
  if (error) throw error;
  return convId;
}
