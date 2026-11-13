// A tap on a push (native/src/lib/pushAction.ts): the reminder's three buttons answer
// the dose; anything malformed only opens a screen, never answers a dose.
import { describe, expect, it } from 'vitest';
import { pushAction } from '../native/src/lib/pushAction';

describe('push taps', () => {
  it('reminder buttons: Taken / Not yet / Later', () => {
    expect(pushAction({ source_kind: 'reminder', event_id: 7 }, 'taken')).toEqual({ kind: 'dose_done', eventId: 7 });
    expect(pushAction({ source_kind: 'reminder', event_id: '7' }, 'not_yet')).toEqual({ kind: 'dose_snooze', eventId: 7, snooze: 'not_yet' });
    expect(pushAction({ source_kind: 'reminder', event_id: 7 }, 'later')).toEqual({ kind: 'dose_snooze', eventId: 7, snooze: 'later' });
  });
  it('a tap on the reminder itself, or an unknown button, opens the elder home', () => {
    expect(pushAction({ source_kind: 'reminder', event_id: 7 }, null)).toEqual({ kind: 'open_home' });
    expect(pushAction({ source_kind: 'reminder', event_id: 7 }, 'delete_everything')).toEqual({ kind: 'open_home' });
  });
  it('a reminder without a valid event id never answers a dose', () => {
    expect(pushAction({ source_kind: 'reminder', event_id: null }, 'taken')).toEqual({ kind: 'open_home' });
    expect(pushAction({ source_kind: 'reminder', event_id: 'x' }, 'taken')).toEqual({ kind: 'open_home' });
    expect(pushAction({ source_kind: 'reminder', event_id: -1 }, 'taken')).toEqual({ kind: 'open_home' });
  });
  it('a missed-dose push to the caretaker opens their home and never answers a dose', () => {
    expect(pushAction({ source_kind: 'reminder_missed', event_id: 7 }, null)).toEqual({ kind: 'open_home' });
    expect(pushAction({ source_kind: 'reminder_missed', event_id: 7 }, 'taken')).toEqual({ kind: 'open_home' });
  });
  it('Rafiq\'s check-in opens the Rafiq chat; the low-mood notice opens the home; buttons do nothing else', () => {
    expect(pushAction({ source_kind: 'rafiq', kind: 'checkin' }, null)).toEqual({ kind: 'open_rafiq' });
    expect(pushAction({ source_kind: 'rafiq', kind: 'checkin' }, 'taken')).toEqual({ kind: 'open_rafiq' });
    expect(pushAction({ source_kind: 'rafiq', kind: 'low_mood' }, null)).toEqual({ kind: 'open_home' });
    expect(pushAction({ source_kind: 'rafiq' }, null)).toEqual({ kind: 'open_alerts' });
  });
  it('every other push opens the alerts, as before', () => {
    expect(pushAction({ source_kind: 'sos' }, null)).toEqual({ kind: 'open_alerts' });
    expect(pushAction(null, 'taken')).toEqual({ kind: 'open_alerts' });
  });
});
