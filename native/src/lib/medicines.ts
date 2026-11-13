// Medicines with reminder times (step32i). A medicine is one or more daily
// reminders (kind 'medication') with the same title — one row per time of day.
// Only the elder and their primary caretaker may add or stop one (founder,
// 2026-11-04); the server refuses everyone else.
import { supabase } from '@/lib/supabase';

export type Medicine = {
  title: string;
  /** "08:00", sorted */
  times: string[];
  /** the reminder rows behind it, same order as times */
  ids: string[];
};

type Row = { id: string; title: string; local_time: string | null };

export const MAX_TIMES = 6;

/** "8" / "08" / "8:5" / "8:05" / "0805" / "20.30" → "08:05"; anything else → null. */
export function parseTime(raw: string): string | null {
  const s = raw.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const m = s.match(/^(\d{1,2})(?:[:.\s]?(\d{1,2}))?$/) ?? s.match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Adds a time to the list once, kept in order, at most MAX_TIMES. */
export function addTime(times: string[], t: string): string[] {
  if (times.includes(t) || times.length >= MAX_TIMES) return times;
  return [...times, t].sort();
}

/** Reminder rows → medicines, by title, in order of their first time. */
export function groupMedicines(rows: Row[]): Medicine[] {
  const by = new Map<string, { t: string; id: string }[]>();
  for (const r of rows) {
    if (!r.local_time) continue;
    const list = by.get(r.title) ?? [];
    list.push({ t: r.local_time.slice(0, 5), id: r.id });
    by.set(r.title, list);
  }
  return [...by.entries()]
    .map(([title, list]) => {
      list.sort((a, b) => a.t.localeCompare(b.t));
      return { title, times: list.map((x) => x.t), ids: list.map((x) => x.id) };
    })
    .sort((a, b) => a.times[0].localeCompare(b.times[0]) || a.title.localeCompare(b.title));
}

export async function listMedicines(elderId: string): Promise<Medicine[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('id, title, local_time')
    .eq('elder_id', elderId)
    .eq('kind', 'medication')
    .eq('active', true);
  if (error) throw error;
  return groupMedicines((data ?? []) as Row[]);
}

export async function addMedicine(elderId: string, name: string, dose: string, times: string[]): Promise<void> {
  const { error } = await supabase.rpc('add_medicine', {
    p_elder_id: elderId,
    p_name: name.trim(),
    p_dose: dose.trim() || null,
    p_times: times,
  });
  if (error) throw error;
}

/** Stops every time of a medicine. */
export async function stopMedicine(m: Medicine): Promise<void> {
  for (const id of m.ids) {
    const { error } = await supabase.rpc('stop_medicine', { p_reminder_id: id });
    if (error) throw error;
  }
}

/** The elders whose medicines this user may change: themselves (an elder), or each
 *  elder whose circle they are the active primary caretaker of. */
export async function elderIdsIManage(userId: string, isElder: boolean): Promise<string[]> {
  if (isElder) return [userId];
  const { data, error } = await supabase
    .from('care_circle_members')
    .select('care_circles!inner(elder_id)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('member_role', 'primary_caretaker');
  if (error) throw error;
  return ((data ?? []) as unknown as { care_circles: { elder_id: string } }[]).map((r) => r.care_circles.elder_id);
}
