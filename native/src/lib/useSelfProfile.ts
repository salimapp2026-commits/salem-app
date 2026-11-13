// Shared self-profile query — used by settings + every role home so the
// avatar shows everywhere consistently and TanStack Query dedupes the
// request across components. Keep the column list narrow and synced with
// the settings screen's query so cache hits work.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

export type SelfProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

export function useSelfProfile() {
  const userId = useAuthStore((s) => s.user?.id);

  return useQuery<SelfProfile | null>({
    queryKey: ['profile-self', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .eq('id', userId!)
        .maybeSingle();
      if (error) throw error;
      return data as SelfProfile | null;
    },
  });
}
