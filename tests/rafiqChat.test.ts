// Rafiq's chat, phase 1 (native/src/lib/rafiqChat): our own rules only. Crisis words
// always win; answers come from real data or say there is none; unknown messages get
// a kind line and chips, never an invented answer; Rafiq speaks first only when due.
import { describe, expect, it } from 'vitest';
import {
  classify, dueProactive, inQuiet, line, mergeConfig, mergeLines, normalise, readingValues, reply, type ChatContext,
} from '../native/src/lib/rafiqChat/engine';
import { DEFAULT_CONFIG, HELP_NUMBERS, LINES } from '../native/src/lib/rafiqChat/lines';
import type { Dose } from '../native/src/lib/elderHome';

const first = () => 0;   // always the first variant

const ctx = (over: Partial<ChatContext> = {}): ChatContext => ({
  role: 'elder', lang: 'en', me: 'Mona', name: 'Mona', doses: [], stats: null, card: null,
  fmtTime: (iso) => iso.slice(11, 16), fmtWhen: () => '10 min ago', ...over,
});
const dose = (id: number, hhmm: string, state: Dose['state'], title = `Med${id}`): Dose =>
  ({ id, title, at: `2026-11-05T${hhmm}:00.000Z`, state });

describe('rafiq chat: understanding a message', () => {
  it('crisis words win over everything, in English and Arabic, however written', () => {
    expect(classify('hello, I want to die')).toBe('crisis');
    expect(classify('I just want to END MY LIFE.')).toBe('crisis');
    expect(classify('انا عايزة أموت')).toBe('crisis');
    expect(classify('مش عاوز أعيش خلاص')).toBe('crisis');
    expect(classify('فكرت في الانتحار')).toBe('crisis');
  });
  it('medicine, readings, mood, greetings, thanks', () => {
    expect(classify('did I take my medicine?')).toBe('meds');
    expect(classify('خدت الدوا؟')).toBe('meds');
    expect(classify('دوايا امتى')).toBe('meds');
    expect(classify('how is my heart rate')).toBe('readings');
    expect(classify('الضغط عامل ايه')).toBe('readings');
    expect(classify('I feel lonely today')).toBe('mood_low');
    expect(classify('مش كويس النهارده')).toBe('mood_low');
    expect(classify('not bad')).toBe('mood_good');
    expect(classify('الحمد لله كويس')).toBe('mood_good');
    expect(classify('hello how are you')).toBe('how_are_you');
    expect(classify('ازيك يا رفيق')).toBe('how_are_you');
    expect(classify('Good morning!')).toBe('greeting');
    expect(classify('صباح الخير')).toBe('greeting');
    expect(classify('thank you')).toBe('thanks');
    expect(classify('شكرا')).toBe('thanks');
  });
  it('a word that merely contains the letters is not a match', () => {
    expect(classify('I read a book')).toBe('unknown');            // "ok" inside "book"
    expect(classify('عندي فلوس كتير')).toBe('unknown');           // "فل" inside "فلوس"
    expect(classify('what is the weather like')).toBe('unknown');
    expect(classify('   ')).toBe('unknown');
  });
  it('the crisis list can come from the server', () => {
    expect(classify('code purple', { en: ['code purple'], ar: [] })).toBe('crisis');
  });
  it('Arabic letters are unified before matching', () => {
    expect(normalise('أموت')).toBe(normalise('اموت'));
    expect(normalise('صحّتي')).toBe(normalise('صحتي'));
  });
});

describe('rafiq chat: replies from real data only', () => {
  it('crisis → the help message with the numbers; only the elder\'s raises the caregiver alert', () => {
    const r = reply('crisis', ctx(), LINES, DEFAULT_CONFIG, first);
    expect(r.crisis).toBe(true);
    expect(r.help).toEqual(HELP_NUMBERS);
    expect(reply('crisis', ctx({ role: 'family' }), LINES, DEFAULT_CONFIG, first).crisis).toBe(false);
  });
  it('medicine: none, all taken, or done / total with the due and next dose by name', () => {
    expect(reply('meds', ctx(), LINES, DEFAULT_CONFIG, first).text).toBe('There’s no medicine scheduled for you today.');
    expect(reply('meds', ctx({ doses: [dose(1, '08:00', 'taken'), dose(2, '12:00', 'taken')] }), LINES, DEFAULT_CONFIG, first).text)
      .toBe('You’ve taken all 2 of today’s doses. Well done!');
    const t = reply('meds', ctx({ doses: [dose(1, '08:00', 'taken'), dose(2, '12:00', 'due', 'Glucophage'), dose(3, '21:00', 'later', 'Aspirin')] }), LINES, DEFAULT_CONFIG, first).text;
    expect(t).toBe('So far today you’ve taken 1 of 3 doses. Glucophage was due at 12:00 — have you taken it? Your next one is Aspirin at 21:00.');
  });
  it('caregivers hear about the elder by name', () => {
    const t = reply('meds', ctx({ role: 'family', me: 'Omar', doses: [dose(1, '08:00', 'taken'), dose(2, '12:00', 'later')] }), LINES, DEFAULT_CONFIG, first).text;
    expect(t.startsWith('Mona has taken 1 of 2 doses so far today.')).toBe(true);
  });
  it('readings: none → says so; learning → day x of 7; never a judgement of a value', () => {
    expect(reply('readings', ctx(), LINES, DEFAULT_CONFIG, first).text).toMatch(/don’t have any readings/);
    const stats = { heartRate: { bpm: 72, bars: [72], at: '2026-11-05T09:50:00Z' }, pressure: null, steps: 1240, band: { kind: 'none' as const } };
    const t = reply('readings', ctx({ stats, card: { state: 'learning', day: 3, of: 7 } }), LINES, DEFAULT_CONFIG, first).text;
    expect(t).toContain('heart rate 72 bpm (10 min ago) · 1,240 steps today');
    expect(t).toContain('day 3 of 7');
    expect(t).toContain('Rafiq is not a medical device.');
    expect(t).not.toMatch(/normal range|high|low|healthy/i);
    const unusual = reply('readings', ctx({ stats, card: { state: 'attention', n: 1, preview: null } }), LINES, DEFAULT_CONFIG, first).text;
    expect(unusual).toContain('unusual compared to your normal. If you’re worried, please contact your doctor.');
  });
  it('blood pressure appears only from a real reading', () => {
    const stats = { heartRate: null, pressure: { systolic: 131, diastolic: 84, at: 'x' }, steps: null, band: { kind: 'none' as const } };
    expect(readingValues(stats, 'en', () => 'yesterday')).toBe('blood pressure 131/84 (yesterday)');
    expect(readingValues(null, 'en', () => '')).toBe('');
  });
  it('anything else: a kind line and suggestion chips, never an invented answer', () => {
    const r = reply('unknown', ctx(), LINES, DEFAULT_CONFIG, first);
    expect(r.text).toMatch(/didn’t quite understand/);
    expect(r.chips).toEqual(['meds', 'readings', 'mood', 'help']);
  });
  it('how are you → asks back with the three faces (elder)', () => {
    expect(reply('how_are_you', ctx(), LINES, DEFAULT_CONFIG, first).mood).toBe(true);
  });
});

describe('rafiq chat: lines', () => {
  it('every category has Arabic and English; reminders and check-ins have 15 each', () => {
    for (const [cat, l] of Object.entries(LINES)) {
      expect(l.en.length, cat).toBeGreaterThan(0);
      expect(l.ar.length, cat).toBeGreaterThan(0);
    }
    for (const cat of ['checkin_morning', 'checkin_evening', 'reminder_dose']) {
      expect(LINES[cat].en.length).toBe(15);
      expect(LINES[cat].ar.length).toBe(15);
    }
  });
  it('the same placeholders in both languages', () => {
    for (const [cat, l] of Object.entries(LINES)) {
      const ph = (xs: string[]) => [...new Set(xs.flatMap((s) => s.match(/\{\w+\}/g) ?? []))].sort();
      expect(ph(l.ar), cat).toEqual(ph(l.en));
    }
  });
  it('a missing name drops cleanly; no "{x}" ever shows', () => {
    expect(line(LINES, 'greeting', 'en', { me: '' }, first)).toBe('Hello! How lovely to hear from you.');
    expect(line(LINES, 'greeting', 'ar', { me: '' }, first)).toBe('أهلاً! نوّرت.');
    expect(line(LINES, 'reminder_dose', 'en', { me: '', med: 'Concor', time: '08:00' }, () => 0.1)).toBe('it’s 08:00 — your Concor is waiting for you.');
    expect(line(LINES, 'reminder_dose', 'en', { me: 'Mona', med: 'Concor', time: '08:00' }, () => 0.1)).toBe('Mona, it’s 08:00 — your Concor is waiting for you.');
  });
  it('server lines replace a category; malformed or unknown ones are ignored', () => {
    const m = mergeLines([
      { category: 'greeting', lang: 'en', text: 'Hi {me}!' },
      { category: 'greeting', lang: 'en', text: 'Off', active: false },
      { category: 'greeting', lang: 'en', text: 'Your pressure is {bp}' },     // placeholder we can't fill
      { category: 'nonsense', lang: 'en', text: 'x' },
      { category: 'greeting', lang: 'fr', text: 'Salut' },
    ]);
    expect(m.greeting.en).toEqual(['Hi {me}!']);
    expect(m.greeting.ar).toEqual(LINES.greeting.ar);
    expect(m.nonsense).toBeUndefined();
    expect(mergeLines(null).greeting).toEqual(LINES.greeting);
  });
  it('server config over the built-in one; bad values fall back; never more than 3 check-ins', () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG);
    const c = mergeConfig({ checkin_times: ['09:30', 'bad'], quiet_start: '25:00', max_checkins: 9, help_numbers: [{ phone: '1' }] });
    expect(c.checkin_times).toEqual(['09:30']);
    expect(c.quiet_start).toBe(DEFAULT_CONFIG.quiet_start);
    expect(c.max_checkins).toBe(3);
    expect(c.help_numbers).toEqual(DEFAULT_CONFIG.help_numbers);
  });
});

describe('rafiq chat: Rafiq speaks first', () => {
  const NOW = Date.parse('2026-11-05T12:00:00Z');
  const at = (h: number, m = 0) => h * 60 + m;
  it('a message for every due, unanswered dose, once', () => {
    const doses = [dose(1, '08:00', 'taken'), dose(2, '09:00', 'due'), dose(3, '21:00', 'later')];
    expect(dueProactive(doses, at(9, 30), [], null, NOW).map((p) => p.key)).toEqual(['dose:2']);
    expect(dueProactive(doses, at(9, 30), ['dose:2'], null, NOW)).toEqual([]);
  });
  it('the latest passed check-in slot only, outside quiet hours, not right after the elder wrote', () => {
    expect(dueProactive([], at(9, 59), [], null, NOW)).toEqual([]);
    expect(dueProactive([], at(10, 5), [], null, NOW)).toEqual([{ key: 'checkin:10:00', kind: 'checkin', slot: '10:00', part: 'morning' }]);
    expect(dueProactive([], at(20), [], null, NOW).map((p) => p.key)).toEqual(['checkin:19:00']);
    expect(dueProactive([], at(20), ['checkin:19:00'], null, NOW)).toEqual([]);
    expect(dueProactive([], at(23), [], null, NOW)).toEqual([]);                       // quiet
    expect(dueProactive([], at(20), [], NOW - 3_600_000, NOW)).toEqual([]);          // wrote an hour ago
    expect(dueProactive([], at(20), [], NOW - 4 * 3_600_000, NOW).length).toBe(1);
  });
  it('at most max_checkins a day; switched off → medicine only', () => {
    const cfg = { ...DEFAULT_CONFIG, checkin_times: ['10:00', '14:00', '17:00', '19:00'], max_checkins: 3 };
    expect(dueProactive([], at(20), ['checkin:10:00', 'checkin:14:00', 'checkin:17:00'], null, NOW, cfg)).toEqual([]);
    const off = { ...DEFAULT_CONFIG, enabled: false };
    expect(dueProactive([dose(2, '09:00', 'due')], at(20), [], null, NOW, off).map((p) => p.key)).toEqual(['dose:2']);
  });
  it('quiet hours that wrap midnight', () => {
    expect(inQuiet(at(23), DEFAULT_CONFIG)).toBe(true);
    expect(inQuiet(at(7, 59), DEFAULT_CONFIG)).toBe(true);
    expect(inQuiet(at(8), DEFAULT_CONFIG)).toBe(false);
    expect(inQuiet(at(13), { quiet_start: '12:00', quiet_end: '14:00' })).toBe(true);
  });
});
