// The elder's choice: tell the family when they answer "Not good" to the mood
// question (step32j / step32l, founder 2026-11-08). On by default. Stored on the
// elder's own profile row; the server checks it before sending the push.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export const moodNoticeKey = (userId: string | undefined) => ['mood-notify-family', userId];

/** True unless the elder turned it off. Before step32l is on the server (no column),
 *  or offline, it reads as on — the server default. */
export function useMoodNotice(userId: string | undefined, enabled = true) {
  return useQuery<boolean>({
    queryKey: moodNoticeKey(userId),
    enabled: enabled && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('mood_notify_family').eq('id', userId!).maybeSingle();
      if (error) return true;
      return (data as { mood_notify_family?: boolean } | null)?.mood_notify_family !== false;
    },
  });
}

export async function setMoodNotice(userId: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ mood_notify_family: on }).eq('id', userId);
  if (error) throw error;
}
