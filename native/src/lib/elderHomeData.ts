// The queries behind the elder home and the caregiver home: the same rows,
// read through row-level security as whoever is signed in (the elder, or a
// caregiver with read-health). Shaped by the pure rules in lib/elderHome.ts.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { type DoseEvent, type Member, type Reading, circleCorners, elderStats } from '@/lib/elderHome';

export function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Today's medicine doses for an elder. */
export function useTodayDoses(elderId: string | undefined) {
  return useQuery({
    queryKey: ['elder-home-doses', elderId],
    enabled: !!elderId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<DoseEvent[]> => {
      const from = startOfToday();
      const to = new Date(Date.parse(from) + 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('reminder_events')
        .select('id, scheduled_at, status, reminders!inner(title, kind)')
        .eq('elder_id', elderId!)
        .eq('reminders.kind', 'medication')
        .gte('scheduled_at', from)
        .lt('scheduled_at', to)
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as { id: number; scheduled_at: string; status: DoseEvent['status']; reminders: { title: string | null } }[])
        .map((r) => ({ id: r.id, scheduled_at: r.scheduled_at, status: r.status, title: r.reminders?.title ?? null }));
    },
  });
}

/** Heart rate, pressure, steps today and the band badge for an elder. */
export function useElderStats(elderId: string | undefined) {
  return useQuery({
    queryKey: ['elder-home-stats', elderId],
    enabled: !!elderId,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const base = () => supabase.from('vitals')
        .select('kind, value_numeric, value_systolic, value_diastolic, captured_at, source').eq('elder_id', elderId!);
      const [hr, bp, steps, band, hc] = await Promise.all([
        base().eq('kind', 'heart_rate').order('captured_at', { ascending: false }).limit(9),
        base().eq('kind', 'blood_pressure').order('captured_at', { ascending: false }).limit(1),
        base().eq('kind', 'steps').gte('captured_at', startOfToday()).limit(2000),
        base().in('source', ['band', 'watch']).order('captured_at', { ascending: false }).limit(1),
        supabase.from('vitals').select('created_at').eq('elder_id', elderId!).eq('source', 'health_connect')
          .order('created_at', { ascending: false }).limit(1),
      ]);
      return elderStats({
        heartRates: (hr.data ?? []) as Reading[],
        pressure: ((bp.data ?? []) as Reading[])[0] ?? null,
        stepsToday: (steps.data ?? []) as Reading[],
        lastBand: ((band.data ?? []) as Reading[])[0] ?? null,
        lastHcSyncAt: ((hc.data ?? []) as { created_at: string }[])[0]?.created_at ?? null,
      }, Date.now());
    },
  });
}

/** The caregiver and the doctor of an elder's circle. */
export function useCircleCorners(elderId: string | undefined) {
  return useQuery({
    queryKey: ['elder-home-circle', elderId],
    enabled: !!elderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('care_circle_members')
        .select('member_role, profiles:user_id(display_name, phone_e164), care_circles!inner(elder_id)')
        .eq('care_circles.elder_id', elderId!)
        .eq('status', 'active');
      if (error) throw error;
      const members = ((data ?? []) as unknown as { member_role: string; profiles: { display_name: string | null; phone_e164: string | null } | null }[])
        .map((m): Member => ({ member_role: m.member_role, display_name: m.profiles?.display_name ?? null, phone_e164: m.profiles?.phone_e164 ?? null }));
      return circleCorners(members);
    },
  });
}
