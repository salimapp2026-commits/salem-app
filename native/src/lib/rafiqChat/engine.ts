// Rafiq's chat, phase 1: our own rules, no outside AI. Pure — imports only types
// and the built-in lines — so every reply is tested without a phone
// (tests/rafiqChat.test.ts).
//
//   classify(text)     what the message is about (crisis is always checked first)
//   reply(…)           Rafiq's answer, from the lines and real data only — never an
//                      invented medical answer; unknown → a kind line + suggestion chips
//   dueProactive(…)    what Rafiq says first when the elder opens the chat: a message
//                      per medicine dose that is due, and the morning / evening check-in
//
// Phase 2 (a self-hosted model) replaces reply() behind the same shape.
import type { Dose, ElderStats } from '../elderHome';
import type { CardState } from '../rafiqCard';
import { type ChatConfig, DEFAULT_CONFIG, type HelpNumber, type Lang, LINES, type Lines } from './lines';

export type Intent =
  | 'crisis' | 'mood_low' | 'meds' | 'readings' | 'how_are_you' | 'greeting' | 'mood_good' | 'thanks' | 'help' | 'unknown';

/** Suggestion chips under a Rafiq message. */
export type Chip = 'meds' | 'readings' | 'mood' | 'help' | 'insights' | 'call';

export type RafiqMsg = {
  text: string;
  chips?: Chip[];
  mood?: boolean;                      // show the three faces
  help?: HelpNumber[];                 // crisis: numbers to call
  crisis?: boolean;                    // the caller raises the caregiver alert (elder only)
};

export type ChatContext = {
  role: 'elder' | 'family' | 'doctor';
  lang: Lang;
  me: string;                          // the viewer's first name ('' if unknown)
  name: string;                        // the elder's first name (for caregivers / doctors)
  doses: Dose[] | null;                // today's doses; null = not loaded
  stats: ElderStats | null;
  card: CardState | null;              // Rafiq's status for the elder
  fmtTime: (iso: string) => string;
  fmtWhen: (iso: string) => string;
};

// ── Text ─────────────────────────────────────────────────────────────────────

/** Lower-case, Arabic letters unified (أإآ→ا, ة→ه, ى→ي, ؤ→و, ئ→ي), no diacritics or
 *  tatweel, punctuation → spaces, single spaces. Both the message and the word lists
 *  go through this, so "عايزة أموت" matches "عايزه اموت". */
export function normalise(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole words only (so "ok" is not inside "book"). */
const has = (text: string, words: string[]) => words.some((w) => {
  const n = normalise(w).trim();
  return n.length > 0 && text.includes(` ${n} `);
});
/** Arabic whole words, allowing the usual prefixes (و ف ب ل ال …) and pronoun endings
 *  (دوايا، الدوا، وصحتي), but not any word that merely contains the letters. */
const AR_PRE = '(?:و|ف|ب|ل|ال|وال|بال|فال|لل)?';
const AR_SUF = '(?:ي|يا|ك|ه|ها|نا|هم|كم|ات|اتي)?';
const hasAr = (text: string, words: string[]) => words.some((w) => {
  const n = normalise(w).trim();
  return n.length > 0 && new RegExp(` ${AR_PRE}${esc(n)}${AR_SUF} `).test(text);
});
/** Crisis words match anywhere, even inside a longer word: missing one costs more than
 *  a false alarm. */
const hasAnywhere = (text: string, words: string[]) => words.some((w) => {
  const n = normalise(w).trim();
  return n.length > 0 && text.includes(n);
});

const K = {
  mood_low: {
    en: ['sad', 'tired', 'lonely', 'alone', 'not good', 'not well', 'not fine', 'bad', 'upset', 'unhappy', 'depressed', 'down', 'worried', 'scared', 'afraid', 'sick', 'pain', 'hurts'],
    ar: ['حزين', 'حزينه', 'زعلان', 'زعلانه', 'تعبان', 'تعبانه', 'مخنوق', 'مخنوقه', 'وحيد', 'وحيده', 'لوحدي', 'مش كويس', 'مش كويسه', 'مش تمام', 'وحش', 'مضايق', 'مضايقه', 'خايف', 'خايفه', 'قلقان', 'قلقانه', 'عيان', 'عيانه', 'وجع', 'بيوجعني'],
  },
  meds: {
    en: ['medicine', 'medicines', 'medication', 'medications', 'meds', 'pill', 'pills', 'tablet', 'tablets', 'dose', 'doses', 'drug', 'drugs'],
    ar: ['دوا', 'دواء', 'ادويه', 'ادويتي', 'برشام', 'حبوب', 'حبايه', 'جرعه', 'جرعات', 'علاج'],
  },
  readings: {
    en: ['reading', 'readings', 'heart', 'pulse', 'heart rate', 'pressure', 'blood pressure', 'steps', 'oxygen', 'band', 'health', 'how am i doing', 'vitals', 'temperature'],
    ar: ['قياس', 'قياسات', 'نبض', 'قلب', 'ضغط', 'خطوات', 'اكسجين', 'صحتي', 'صحته', 'صحتها', 'السوار', 'اسوره', 'حراره'],
  },
  how_are_you: {
    en: ['how are you', 'how r u', 'how are u', 'how do you do', 'hows it going', 'how is it going'],
    ar: ['ازيك', 'عامل ايه', 'عامله ايه', 'اخبارك', 'اخبارك ايه', 'كيف حالك', 'كيفك', 'انت كويس'],
  },
  greeting: {
    en: ['hi', 'hello', 'hey', 'good morning', 'good evening', 'good afternoon', 'morning', 'evening', 'salam', 'salaam'],
    ar: ['اهلا', 'مرحبا', 'السلام عليكم', 'سلام', 'صباح الخير', 'صباح النور', 'صباح الفل', 'مساء الخير', 'مساء النور', 'هاي'],
  },
  mood_good: {
    en: ['good', 'fine', 'great', 'well', 'happy', 'ok', 'okay', 'better', 'wonderful', 'alright', 'all good'],
    ar: ['الحمد لله', 'الحمدلله', 'كويس', 'كويسه', 'تمام', 'مبسوط', 'مبسوطه', 'فل', 'زي الفل', 'احسن', 'بخير'],
  },
  thanks: {
    en: ['thanks', 'thank you', 'thank u', 'thx', 'cheers'],
    ar: ['شكرا', 'متشكر', 'متشكره', 'ربنا يخليك', 'تسلم', 'تسلمي'],
  },
  help: {
    en: ['help', 'what can you do', 'what do you do', 'menu', 'options'],
    ar: ['ساعدني', 'مساعده', 'تقدر تعمل ايه', 'بتعمل ايه', 'اعمل ايه'],
  },
} satisfies Record<string, Record<Lang, string[]>>;

/** What a message is about. Crisis words always win, then the order below
 *  ("not good" is low mood before "good" is good mood; "good morning" a greeting). */
export function classify(text: string, crisisWords: Record<Lang, string[]> = DEFAULT_CONFIG.crisis_words): Intent {
  const raw = normalise(text);
  if (raw.trim() === '') return 'unknown';
  if (hasAnywhere(raw, crisisWords.en) || hasAnywhere(raw, crisisWords.ar)) return 'crisis';
  // "not bad" is a good answer, not a low mood.
  const n = raw.replace(/ not bad /g, ' fine ').replace(/ مش (?:وحش|بطال) /g, ' كويس ');
  const order: Exclude<Intent, 'crisis' | 'unknown'>[] =
    ['mood_low', 'meds', 'readings', 'how_are_you', 'greeting', 'mood_good', 'thanks', 'help'];
  for (const intent of order) {
    if (has(n, K[intent].en) || hasAr(n, K[intent].ar)) return intent;
  }
  return 'unknown';
}

// ── Lines ────────────────────────────────────────────────────────────────────

export type ServerLine = { category: string; lang: string; text: string; active?: boolean | null };

/** The server's lines win per category and language; anything it lacks comes from the
 *  built-in copy. A server line with a placeholder the built-in line doesn't have is
 *  dropped (it could never be filled from real data). */
export function mergeLines(server: ServerLine[] | null | undefined, builtIn: Lines = LINES): Lines {
  const out: Lines = {};
  for (const [cat, langs] of Object.entries(builtIn)) out[cat] = { en: [...langs.en], ar: [...langs.ar] };
  const grouped = new Map<string, string[]>();
  for (const l of server ?? []) {
    if (l.active === false || !(l.lang === 'en' || l.lang === 'ar') || !l.text?.trim()) continue;
    const allowed = new Set([...(builtIn[l.category]?.en ?? []), ...(builtIn[l.category]?.ar ?? [])]
      .flatMap((s) => s.match(/\{\w+\}/g) ?? []));
    const used = l.text.match(/\{\w+\}/g) ?? [];
    if (!builtIn[l.category] || used.some((p) => !allowed.has(p))) continue;
    const key = `${l.category}\u0000${l.lang}`;
    grouped.set(key, [...(grouped.get(key) ?? []), l.text.trim()]);
  }
  for (const [key, texts] of grouped) {
    const [cat, lang] = key.split('\u0000') as [string, Lang];
    out[cat][lang] = texts;
  }
  return out;
}

/** The server's chat settings over the built-in ones; anything malformed is ignored. */
export function mergeConfig(server: unknown): ChatConfig {
  const s = (server && typeof server === 'object' ? server : {}) as Record<string, unknown>;
  const hhmm = (v: unknown, d: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
  const words = (v: unknown): Record<Lang, string[]> | null => {
    const w = v as Record<string, unknown> | null;
    return w && Array.isArray(w.en) && Array.isArray(w.ar) && [...w.en, ...w.ar].every((x) => typeof x === 'string')
      ? { en: w.en as string[], ar: w.ar as string[] } : null;
  };
  const numbers = Array.isArray(s.help_numbers)
    && s.help_numbers.length > 0
    && s.help_numbers.every((h) => h && typeof h.phone === 'string' && h.label && typeof h.label.en === 'string' && typeof h.label.ar === 'string')
    ? (s.help_numbers as HelpNumber[]) : null;
  const times = Array.isArray(s.checkin_times) ? s.checkin_times.filter((t) => hhmm(t, '') !== '') as string[] : null;
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_CONFIG.enabled,
    checkin_times: times ?? DEFAULT_CONFIG.checkin_times,
    quiet_start: hhmm(s.quiet_start, DEFAULT_CONFIG.quiet_start),
    quiet_end: hhmm(s.quiet_end, DEFAULT_CONFIG.quiet_end),
    max_checkins: typeof s.max_checkins === 'number' && s.max_checkins >= 0 ? Math.min(s.max_checkins, 3) : DEFAULT_CONFIG.max_checkins,
    crisis_words: words(s.crisis_words) ?? DEFAULT_CONFIG.crisis_words,
    help_numbers: numbers ?? DEFAULT_CONFIG.help_numbers,
  };
}

/** One line of a category, placeholders filled; a missing value never shows as "{x}".
 *  An empty {me} drops the name with its comma ("Hello {me}!" → "Hello!"). */
export function line(lines: Lines, category: string, lang: Lang, vars: Record<string, string | number> = {}, pick = Math.random): string {
  const options = lines[category]?.[lang] ?? LINES[category]?.[lang] ?? [];
  if (!options.length) return '';
  const raw = options[Math.min(options.length - 1, Math.floor(pick() * options.length))];
  return raw
    .replace(/,?\s*(يا\s*)?\{me\}/g, (m) => (vars.me ? m.replace('{me}', String(vars.me)) : ''))
    .replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined && vars[k] !== '' ? String(vars[k]) : ''))
    .replace(/\s+([!?.،؟])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,،]+/, '')
    .trim();
}

// ── Replies ──────────────────────────────────────────────────────────────────

const ELDER_CHIPS: Chip[] = ['meds', 'readings', 'mood'];
const CARER_CHIPS: Chip[] = ['meds', 'readings', 'insights'];

/** Rafiq's answer. Facts come from ctx only; nothing is invented. */
export function reply(intent: Intent, ctx: ChatContext, lines: Lines, cfg: ChatConfig = DEFAULT_CONFIG, pick = Math.random): RafiqMsg {
  const elder = ctx.role === 'elder';
  const v = { me: ctx.me, name: ctx.name };
  const L = (cat: string, extra: Record<string, string | number> = {}) => line(lines, cat, ctx.lang, { ...v, ...extra }, pick);
  const chips = elder ? ELDER_CHIPS : CARER_CHIPS;

  switch (intent) {
    case 'crisis':
      return { text: L(elder ? 'crisis_help' : 'c_crisis_help'), help: cfg.help_numbers, crisis: elder, chips: elder ? ['call'] : undefined };
    case 'meds':
      return { text: medsText(ctx, L), chips };
    case 'readings':
      return { text: readingsText(ctx, L), chips };
    case 'mood_low':
      return elder ? { text: L('mood_low'), chips: ['call', 'mood'] } : { text: L('c_fallback'), chips };
    case 'mood_good':
      return elder ? { text: L('mood_good'), chips } : { text: L('c_greeting'), chips };
    case 'how_are_you':
      return elder ? { text: L('how_are_you'), mood: true } : { text: L('c_greeting'), chips };
    case 'greeting':
      return { text: L(elder ? 'greeting' : 'c_greeting'), chips };
    case 'thanks':
      return { text: L('thanks'), chips };
    case 'help':
      return { text: L(elder ? 'help' : 'c_help'), chips };
    default:
      return { text: L(elder ? 'fallback' : 'c_fallback'), chips: elder ? [...ELDER_CHIPS, 'help'] : chips };
  }
}

type LFn = (cat: string, extra?: Record<string, string | number>) => string;

function medsText(ctx: ChatContext, L: LFn): string {
  const c = ctx.role === 'elder' ? '' : 'c_';
  const doses = ctx.doses ?? [];
  if (!doses.length) return L(`${c}meds_none`);
  const total = doses.length;
  const done = doses.filter((d) => d.state === 'taken').length;
  if (done === total) return L(`${c}meds_all_taken`, { total });
  const parts = [L(`${c}meds_status`, { done, total })];
  const due = doses.find((d) => d.state === 'due');
  if (due && due.title) parts.push(L(`${c}meds_due`, { med: due.title, time: ctx.fmtTime(due.at) }));
  const next = doses.find((d) => d.state === 'later');
  if (next && next.title) parts.push(L(`${c}meds_next`, { med: next.title, time: ctx.fmtTime(next.at) }));
  return parts.join(' ');
}

/** Latest real values, e.g. "heart rate 72 bpm · steps today 1,240". Empty if none. */
export function readingValues(stats: ElderStats | null, lang: Lang, fmtWhen: (iso: string) => string): string {
  if (!stats) return '';
  const out: string[] = [];
  if (stats.heartRate) {
    const when = ` (${fmtWhen(stats.heartRate.at)})`;
    out.push(lang === 'ar' ? `النبض ${stats.heartRate.bpm} نبضة/دقيقة${when}` : `heart rate ${stats.heartRate.bpm} bpm${when}`);
  }
  if (stats.pressure) {
    const p = `${stats.pressure.systolic}/${stats.pressure.diastolic}`;
    out.push(lang === 'ar' ? `الضغط ${p} (${fmtWhen(stats.pressure.at)})` : `blood pressure ${p} (${fmtWhen(stats.pressure.at)})`);
  }
  if (stats.steps !== null) {
    out.push(lang === 'ar' ? `${stats.steps.toLocaleString('en-US')} خطوة النهارده` : `${stats.steps.toLocaleString('en-US')} steps today`);
  }
  return out.join(' · ');
}

function readingsText(ctx: ChatContext, L: LFn): string {
  const c = ctx.role === 'elder' ? '' : 'c_';
  const values = readingValues(ctx.stats, ctx.lang, ctx.fmtWhen);
  const parts: string[] = [];
  if (values) parts.push(L(`${c}readings_values`, { values }));

  const card = ctx.card;
  if (card?.state === 'learning') parts.push(L(`${c}readings_learning`, { day: card.day, of: card.of }));
  else if (card?.state === 'usual') parts.push(L(`${c}readings_usual`));
  else if (card?.state === 'watch' || card?.state === 'attention') parts.push(L(`${c}readings_unusual`));
  else if (card?.state === 'stale') parts.push(L(`${c}readings_stale`));

  if (!parts.length) return L(`${c}readings_none`);
  parts.push(L('not_device'));
  return parts.join(' ');
}

// ── Rafiq speaks first (elder) ───────────────────────────────────────────────

export type Proactive = { key: string; kind: 'dose'; dose: Dose } | { key: string; kind: 'checkin'; slot: string; part: 'morning' | 'evening' };

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Is this local minute-of-day inside the quiet hours (which may wrap midnight)? */
export function inQuiet(minute: number, cfg: Pick<ChatConfig, 'quiet_start' | 'quiet_end'>): boolean {
  const s = mins(cfg.quiet_start);
  const e = mins(cfg.quiet_end);
  return s <= e ? minute >= s && minute < e : minute >= s || minute < e;
}

/**
 * What Rafiq should post now that it hasn't yet.
 * @param localMinute   minutes since local midnight
 * @param sentToday     keys already posted today
 * @param lastMineMs    when the elder last wrote (ms), or null
 * @param nowMs         now (ms)
 *
 * • every dose that is due and unanswered, once each (medicine is never held back)
 * • the latest check-in slot that has passed — not during quiet hours, at most
 *   max_checkins a day, and not if the elder wrote in the last 3 hours
 */
export function dueProactive(
  doses: Dose[], localMinute: number, sentToday: string[], lastMineMs: number | null, nowMs: number, cfg: ChatConfig = DEFAULT_CONFIG,
): Proactive[] {
  const out: Proactive[] = [];
  for (const d of doses) {
    const key = `dose:${d.id}`;
    if (d.state === 'due' && d.title && !sentToday.includes(key)) out.push({ key, kind: 'dose', dose: d });
  }
  if (!cfg.enabled) return out;

  const checkinsSent = sentToday.filter((k) => k.startsWith('checkin:')).length;
  const passed = [...cfg.checkin_times].sort().filter((t) => mins(t) <= localMinute);
  const slot = passed[passed.length - 1];
  const quietNow = inQuiet(localMinute, cfg);
  const recentlyWrote = lastMineMs !== null && nowMs - lastMineMs < 3 * 3_600_000;
  if (slot && !quietNow && !recentlyWrote && checkinsSent < cfg.max_checkins && !sentToday.includes(`checkin:${slot}`)) {
    out.push({ key: `checkin:${slot}`, kind: 'checkin', slot, part: mins(slot) < 15 * 60 ? 'morning' : 'evening' });
  }
  return out;
}
