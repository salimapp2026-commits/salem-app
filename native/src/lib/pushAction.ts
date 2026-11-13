// What a tap on a push means (App.tsx). Pure — no imports — tested in
// tests/pushAction.test.ts.
//
// A medicine reminder (step32e) carries the dose's event_id and three buttons:
//   Taken → the dose is done · Not yet → again in 15 min · Later → again in 60 min
// A tap on the reminder itself opens the elder home, where the dose can be answered.
// A "missed dose" push to the primary caretaker (step32f) opens their home, where
// today's doses are. Rafiq's check-in (step32j) opens the Rafiq chat; the low-mood
// notice to the family opens their home. Every other push opens that role's alerts.

export type PushTap = { source_kind?: string; event_id?: number | string | null; kind?: string };

export type PushAction =
  | { kind: 'dose_done'; eventId: number }
  | { kind: 'dose_snooze'; eventId: number; snooze: 'not_yet' | 'later' }
  | { kind: 'open_home' }
  | { kind: 'open_rafiq' }
  | { kind: 'open_alerts' };

export function pushAction(data: PushTap | null | undefined, actionId: string | null | undefined): PushAction {
  if (data?.source_kind === 'reminder_missed') return { kind: 'open_home' };
  if (data?.source_kind === 'rafiq' && data.kind === 'checkin') return { kind: 'open_rafiq' };
  if (data?.source_kind === 'rafiq' && data.kind === 'low_mood') return { kind: 'open_home' };
  if (data?.source_kind !== 'reminder') return { kind: 'open_alerts' };
  const eventId = Number(data.event_id);
  if (!Number.isInteger(eventId) || eventId <= 0) return { kind: 'open_home' };
  if (actionId === 'taken') return { kind: 'dose_done', eventId };
  if (actionId === 'not_yet' || actionId === 'later') return { kind: 'dose_snooze', eventId, snooze: actionId };
  return { kind: 'open_home' };
}
