// Rafiq's words, in English and Arabic — fixed templates, no AI.
// Arabic diacritics are written as \uXXXX escapes (same strings at runtime):
// raw combining marks can be lost when the file is pasted into a deploy.
//
// Rules (founder + lawyer notes, docs/RAFIQ_LEGAL_NOTES.md):
//   • describe the change only: which reading, roughly how far from THIS
//     person's usual, for how long;
//   • never name a condition (no "fever", "infection", "apnea"…), never a cause,
//     never a prediction;
//   • every alert ends with NOTE: unusual compared to their normal, not a
//     diagnosis, contact the doctor if worried;
//   • Arabic avoids gendered pronouns for the elder (the name is used instead).
import type { Level, Reason } from './core.ts';

export type Lang = 'en' | 'ar';

export const NOTE: Record<Lang, (name: string) => string> = {
  en: (n) => `This is unusual compared to ${n}'s normal — it is not a diagnosis. Contact the doctor if you are worried.`,
  ar: (n) => `هذا غير معتاد مقارنة\u064B بالطبيعي لدى ${n}، وليس تشخيص\u064Bا. تواصل مع الطبيب إذا كنت قلق\u064Bا.`,
};

/** Shown on every Rafiq screen. */
export const NOT_A_DEVICE: Record<Lang, string> = {
  en: "Rafiq compares readings with this person's own normal. It does not diagnose, and Salem is not a medical device. Contact the doctor if you are worried.",
  ar: 'يقارن رفيق القراءات بالطبيعي لدى هذا الشخص نفسه. لا يقد\u0651م تشخيص\u064Bا، وسليم ليس جهاز\u064Bا طبي\u064Bا. تواصل مع الطبيب إذا كنت قلق\u064Bا.',
};

const num = (x: number, decimals = 0) => {
  const f = 10 ** decimals;
  const r = Math.round(x * f) / f;
  return decimals === 0 ? String(Math.round(x)) : String(Number.isInteger(r) ? r : r.toFixed(decimals));
};

function nights(n: number, lang: Lang): string {
  if (lang === 'en') return n === 1 ? '1 night' : `${n} nights`;
  if (n === 1) return 'ليلة واحدة';
  if (n === 2) return 'ليلتين';
  return n <= 10 ? `${n} ليال\u064D` : `${n} ليلة`;
}

function days(n: number, lang: Lang): string {
  if (lang === 'en') return n === 1 ? '1 day' : `${n} days`;
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  return n <= 10 ? `${n} أيام` : `${n} يوم\u064Bا`;
}

const FEATURE_LABEL: Record<string, Record<Lang, string>> = {
  z_hr_night: { en: 'resting heart rate at night', ar: 'نبض الراحة ليل\u064Bا' },
  z_hr_day: { en: 'resting heart rate during the day', ar: 'نبض الراحة نهار\u064Bا' },
  z_spo2_night: { en: 'oxygen at night', ar: 'الأكسجين ليل\u064Bا' },
  z_spo2_low: { en: 'the lowest oxygen readings at night', ar: 'أدنى قراءات الأكسجين ليل\u064Bا' },
  z_temp_night: { en: 'skin temperature at night', ar: 'حرارة الجلد ليل\u064Bا' },
  z_temp_day: { en: 'skin temperature during the day', ar: 'حرارة الجلد نهار\u064Bا' },
  z_steps: { en: 'activity', ar: 'النشاط' },
  z_move_night: { en: 'movement at night', ar: 'الحركة ليل\u064Bا' },
  z_wear: { en: 'how long the band was worn', ar: 'مدة ارتداء السوار' },
};

const n_ = (p: Reason['params'], k: string) => p[k] as number;

/** The plain-language reason, without the closing note. */
export function reasonText(r: Reason, name: string, lang: Lang): string {
  const p = r.params;
  switch (r.code) {
    case 'resting_hr_up': {
      const period = p.part === 'hr_day' ? days(r.days, lang) : nights(r.days, lang);
      return lang === 'en'
        ? `${name}'s resting heart rate has been ${num(n_(p, 'delta'))} bpm above their usual (${num(n_(p, 'usual'))} bpm) for ${period}.`
        : `نبض ${name} أثناء الراحة أعلى من المعتاد (${num(n_(p, 'usual'))}) بنحو ${num(n_(p, 'delta'))} نبضة في الدقيقة منذ ${period}.`;
    }
    case 'spo2_night_down': {
      const drop = n_(p, 'drop');
      if (drop === drop && drop >= 1) {
        return lang === 'en'
          ? `${name}'s oxygen level at night has been about ${num(drop, 1)} points below their usual (${num(n_(p, 'usual'))}%) for ${nights(r.days, lang)}.`
          : `نسبة الأكسجين لدى ${name} ليل\u064Bا أقل من المعتاد (${num(n_(p, 'usual'))}٪) بنحو ${num(drop, 1)} نقطة منذ ${nights(r.days, lang)}.`;
      }
      return lang === 'en'
        ? `${name}'s lowest oxygen readings at night have been about ${num(n_(p, 'low_drop'), 1)} points lower than usual for ${nights(r.days, lang)}.`
        : `أدنى قراءات الأكسجين لدى ${name} ليل\u064Bا أقل من المعتاد بنحو ${num(n_(p, 'low_drop'), 1)} نقطة منذ ${nights(r.days, lang)}.`;
    }
    case 'temp_up': {
      const withHr = r.level !== 'watch';
      return lang === 'en'
        ? `${name}'s skin temperature has been about ${num(n_(p, 'delta'), 1)} °C above their usual${withHr ? ', together with a higher resting heart rate' : ''} (${days(r.days, lang)}).`
        : `حرارة جلد ${name} أعلى من المعتاد بنحو ${num(n_(p, 'delta'), 1)} درجة${withHr ? '، مع نبض راحة أعلى من المعتاد' : ''} (${days(r.days, lang)}).`;
    }
    case 'activity_down': {
      const pct = Math.round((1 - n_(p, 'ratio')) * 100);
      return lang === 'en'
        ? `${name} has been about ${pct}% less active than usual for ${days(r.days, lang)}.`
        : `نشاط ${name} أقل من المعتاد بنحو ${pct}٪ منذ ${days(r.days, lang)}.`;
    }
    case 'spo2_low_hr_high':
      return lang === 'en'
        ? `Last night ${name}'s oxygen level was around ${num(n_(p, 'spo2'))}% while their resting heart rate was ${num(n_(p, 'hr_rise'))} bpm above usual.`
        : `الليلة الماضية كانت نسبة الأكسجين لدى ${name} حوالي ${num(n_(p, 'spo2'))}٪ بينما كان نبض الراحة أعلى من المعتاد بـ${num(n_(p, 'hr_rise'))} نبضة.`;
    case 'inactive_awake':
      return lang === 'en'
        ? `Yesterday ${name} did not move for about ${num(n_(p, 'hours'), 1)} hours in a row during the day, while wearing the band.`
        : `أمس لم ي\u064Fسج\u064E\u0651ل أي تحرك لـ${name} لنحو ${num(n_(p, 'hours'), 1)} ساعات متواصلة نهار\u064Bا والسوار في اليد.`;
    case 'fall_then_still':
      return lang === 'en'
        ? `The band recorded a possible fall for ${name}, followed by about ${num(n_(p, 'minutes'))} minutes without movement.`
        : `سج\u0651ل السوار احتمال سقوط لـ${name}، تلاه نحو ${num(n_(p, 'minutes'))} دقيقة دون حركة.`;
    case 'unusual_pattern': {
      const labels = ((p.top as string[]) ?? []).map((k) => FEATURE_LABEL[k]?.[lang] ?? k);
      const list = lang === 'en' ? labels.join(' and ') : labels.join(' و');
      return lang === 'en'
        ? `Several of ${name}'s readings were unusual together, mainly ${list}.`
        : `عدة قراءات لدى ${name} كانت غير معتادة مع\u064Bا، أبرزها ${list}.`;
    }
    default:
      return lang === 'en' ? `Something in ${name}'s readings was unusual.` : `كان شيء ما في قراءات ${name} غير معتاد.`;
  }
}

/** Reason + the closing note: what the family and doctor read. */
export function alertText(r: Reason, name: string, lang: Lang): string {
  return `${reasonText(r, name, lang)} ${NOTE[lang](name)}`;
}

export function pushTitle(level: Level, name: string, lang: Lang): string {
  if (lang === 'en') {
    if (level === 'urgent') return `Rafiq: please check on ${name} now`;
    if (level === 'alert') return `Rafiq: a change in ${name}'s readings`;
    return `Rafiq: something to keep an eye on for ${name}`;
  }
  if (level === 'urgent') return `رفيق: اطمئن على ${name} الآن`;
  if (level === 'alert') return `رفيق: تغي\u0651ر في قراءات ${name}`;
  return `رفيق: أمر يستحق المتابعة لدى ${name}`;
}

/** Status line for the insights screen. */
export function levelLabel(level: Level, lang: Lang): string {
  const en = { normal: 'Usual for them', watch: 'Worth keeping an eye on', alert: 'A change worth checking', urgent: 'Check on them now' };
  const ar = { normal: 'معتاد', watch: 'يستحق المتابعة', alert: 'تغي\u0651ر يستحق الاطمئنان', urgent: 'اطمئن الآن' };
  return (lang === 'en' ? en : ar)[level];
}
