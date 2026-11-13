// notify-fanout's OneSignal body (supabase/functions/_shared/pushPayload.ts): unchanged
// for callers that send nothing new; reminder buttons in the recipient's language; the
// event id travels in the data; a reminder expires.
import { describe, expect, it } from 'vitest';
import { isButtons, oneSignalAuth, oneSignalBody } from '../supabase/functions/_shared/pushPayload';

const base = { appId: 'app', playerIds: ['p1'], title: 'T', text: 'B', lang: 'en' as const, critical: false,
  data: { elder_id: 'e', severity: 'info', source_kind: 'reminder', source_id: null } };
const BUTTONS = [{ id: 'taken', en: 'Taken', ar: 'أخذته' }, { id: 'not_yet', en: 'Not yet', ar: 'لسه' }, { id: 'later', en: 'Later', ar: 'بعدين' }];

describe('push payload', () => {
  it('callers that send nothing new get the v5 body', () => {
    expect(oneSignalBody(base)).toEqual({
      app_id: 'app', include_player_ids: ['p1'], headings: { en: 'T', ar: 'T' }, contents: { en: 'B', ar: 'B' },
      priority: 5, data: base.data,
    });
    expect(oneSignalBody({ ...base, critical: true }).priority).toBe(10);
  });
  it('reminder buttons in the recipient\'s language; event id in the data; one hour to live', () => {
    const b = oneSignalBody({ ...base, buttons: BUTTONS, extraData: { event_id: 7 }, ttlSeconds: 3600 });
    expect(b.buttons).toEqual([{ id: 'taken', text: 'Taken' }, { id: 'not_yet', text: 'Not yet' }, { id: 'later', text: 'Later' }]);
    expect(b.data).toMatchObject({ event_id: 7, source_kind: 'reminder' });
    expect(b.ttl).toBe(3600);
    expect((oneSignalBody({ ...base, lang: 'ar', buttons: BUTTONS }).buttons as { text: string }[])[0].text).toBe('أخذته');
  });
  it('extra data can never overwrite the routing fields', () => {
    expect(oneSignalBody({ ...base, extraData: { source_kind: 'sos', elder_id: 'x' } }).data).toMatchObject({ source_kind: 'reminder', elder_id: 'e' });
  });
  it('only well-formed buttons (1–3, both languages) are accepted', () => {
    expect(isButtons(BUTTONS)).toBe(true);
    expect(isButtons([])).toBe(false);
    expect(isButtons([...BUTTONS, BUTTONS[0]])).toBe(false);
    expect(isButtons([{ id: 'x', en: 'X' }])).toBe(false);
    expect(isButtons(null)).toBe(false);
  });
});

describe('OneSignal sign-in header', () => {
  it('new App API keys use "Key", old REST keys "Basic"', () => {
    expect(oneSignalAuth('os_v2_app_abc')).toBe('Key os_v2_app_abc');
    expect(oneSignalAuth(' os_v2_app_abc\n')).toBe('Key os_v2_app_abc');
    expect(oneSignalAuth('NGEwZGZh')).toBe('Basic NGEwZGZh');
  });
});
