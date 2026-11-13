// Fixed Trend Watch wording: the closing line every message carries, the
// metric names, the ONLY next steps Trend Watch may suggest, and the templates
// used whenever the AI text is missing or fails the safety filter.
//
// Next steps are never written by the AI. They are picked here, in code, from
// the allowed list in the product rules, so a model can't add a medicine or
// dose suggestion even by accident.
//
// Every template in this file must itself pass checkSafety(); the test suite
// enforces that.

export type Lang = 'en' | 'ar';

export type Metric =
  | 'resting_hr'
  | 'spo2'
  | 'skin_temp'
  | 'activity'
  | 'night_restlessness'
  | 'bp_systolic'
  | 'glucose';

export const METRICS: Metric[] = [
  'resting_hr',
  'spo2',
  'skin_temp',
  'activity',
  'night_restlessness',
  'bp_systolic',
  'glucose',
];

/** Appended to every trend message, after the safety check has run. */
export const DISCLAIMER: Record<Lang, string> = {
  en: 'Salem notices changes; it does not diagnose. Your doctor decides what they mean.',
  ar: 'س\u064Eليم يلاحظ التغي\u0651رات ولا يشخ\u0651ص. طبيبك هو من يحد\u0651د ما تعنيه.',
};

export const METRIC_LABEL: Record<Metric, Record<Lang, string>> = {
  resting_hr: { en: 'Resting heart rate', ar: 'نبض القلب أثناء الراحة' },
  spo2: { en: 'Blood oxygen', ar: 'نسبة الأكسجين في الدم' },
  skin_temp: { en: 'Skin temperature', ar: 'حرارة الجلد' },
  activity: { en: 'Daily activity', ar: 'النشاط اليومي' },
  night_restlessness: { en: 'Night-time movement', ar: 'الحركة أثناء الليل' },
  bp_systolic: { en: 'Blood pressure (upper number)', ar: 'ضغط الدم (الرقم الأعلى)' },
  glucose: { en: 'Blood sugar readings', ar: 'قراءات السكر في الدم' },
};

export const METRIC_UNIT: Record<Metric, Record<Lang, string>> = {
  resting_hr: { en: 'bpm', ar: 'نبضة/دقيقة' },
  spo2: { en: '%', ar: '٪' },
  skin_temp: { en: '°C', ar: '°م' },
  activity: { en: 'steps', ar: 'خطوة' },
  night_restlessness: { en: 'movements', ar: 'حركة' },
  bp_systolic: { en: 'mmHg', ar: 'مم زئبق' },
  glucose: { en: 'mg/dL', ar: 'ملغ/دل' },
};

// --------------------------------------------------------------- next steps
export type NextStep =
  | 'contact_doctor'
  | 'check_medicines_taken'
  | 'drink_water'
  | 'rest'
  | 'measure_bp'
  | 'measure_temperature'
  | 'move_gently'
  | 'emergency_if_unwell';

export const NEXT_STEP_TEXT: Record<NextStep, Record<Lang, string>> = {
  contact_doctor: {
    en: 'Contact the doctor or book a check-up.',
    ar: 'تواصل مع الطبيب أو احجز موعد\u064Bا للفحص.',
  },
  check_medicines_taken: {
    en: 'Check that medicines are being taken as prescribed.',
    ar: 'تأكد من أخذ الأدوية كما وصفها الطبيب.',
  },
  drink_water: { en: 'Drink enough water.', ar: 'اشرب كمية كافية من الماء.' },
  rest: { en: 'Get some rest.', ar: 'احصل على قسط من الراحة.' },
  measure_bp: { en: 'Measure blood pressure.', ar: 'ق\u0650س ضغط الدم.' },
  measure_temperature: { en: 'Measure body temperature.', ar: 'ق\u0650س درجة حرارة الجسم.' },
  move_gently: { en: 'Keep moving gently during the day.', ar: 'حافظ على الحركة الخفيفة خلال اليوم.' },
  emergency_if_unwell: {
    en: 'Call emergency services if there is chest pain, breathlessness, fainting or confusion.',
    ar: 'اتصل بالإسعاف عند الشعور بألم في الصدر أو ضيق في التنفس أو إغماء أو تشو\u0651ش.',
  },
};

/** The allowed steps for a metric, most relevant first. Always ends with the emergency line. */
export function nextStepsFor(metric: Metric, severity: 'info' | 'warning'): NextStep[] {
  const base: Record<Metric, NextStep[]> = {
    resting_hr: ['rest', 'drink_water', 'check_medicines_taken'],
    spo2: ['rest', 'check_medicines_taken'],
    skin_temp: ['measure_temperature', 'drink_water', 'rest'],
    activity: ['move_gently', 'check_medicines_taken'],
    night_restlessness: ['rest', 'check_medicines_taken'],
    bp_systolic: ['measure_bp', 'check_medicines_taken'],
    glucose: ['check_medicines_taken', 'drink_water'],
  };
  const steps = [...base[metric]];
  // A warning always points to the doctor; an info only does for the
  // metrics where the doctor is the natural next contact.
  if (severity === 'warning' || metric === 'bp_systolic' || metric === 'glucose') {
    steps.unshift('contact_doctor');
  }
  steps.push('emergency_if_unwell');
  return steps;
}

// ---------------------------------------------------------------- templates
export type FindingFacts = {
  metric: Metric;
  name: string; // elder's display name
  baseline: number;
  current: number;
  change: number; // signed, in the metric's unit (or percent for pct metrics)
  days: number;
};

function fmt(n: number, metric: Metric): string {
  const digits = metric === 'skin_temp' ? 1 : 0;
  return Math.abs(n).toFixed(digits);
}

/**
 * Plain description of a finding. Describes the change only — no cause, no
 * prediction, no advice (advice comes from nextStepsFor).
 */
export function findingTemplate(f: FindingFacts, lang: Lang): string {
  const n = f.name;
  const d = f.days;
  const delta = fmt(f.change, f.metric);
  const base = fmt(f.baseline, f.metric);
  const cur = fmt(f.current, f.metric);
  const en: Record<Metric, string> = {
    resting_hr: `${n}'s resting heart rate has been about ${delta} beats per minute above their usual for ${d} days (usual about ${base}, recently about ${cur}).`,
    spo2: `${n}'s resting blood oxygen has been about ${delta} points below their usual on ${d} of the last 5 days (usual about ${base}%, recently about ${cur}%).`,
    skin_temp: `${n}'s skin temperature has been about ${delta} °C above their usual for ${d} days.`,
    activity: `${n} has been about ${delta}% less active than usual over the past week (usual about ${base} steps a day, recently about ${cur}).`,
    night_restlessness: `${n} has been moving about ${delta}% more than usual at night for ${d} nights.`,
    bp_systolic: `${n}'s logged blood pressure (upper number) has averaged about ${delta} mmHg above their usual this week (usual about ${base}, recently about ${cur}).`,
    glucose: `${n}'s logged blood sugar readings have averaged about ${delta}% above their usual this week.`,
  };
  const ar: Record<Metric, string> = {
    resting_hr: `نبض القلب أثناء الراحة لدى ${n} أعلى من المعتاد بحوالي ${delta} نبضة في الدقيقة منذ ${d} أيام (المعتاد حوالي ${base}، ومؤخر\u064Bا حوالي ${cur}).`,
    spo2: `نسبة الأكسجين أثناء الراحة لدى ${n} أقل من المعتاد بحوالي ${delta} نقاط في ${d} من آخر 5 أيام (المعتاد حوالي ${base}٪، ومؤخر\u064Bا حوالي ${cur}٪).`,
    skin_temp: `حرارة الجلد لدى ${n} أعلى من المعتاد بحوالي ${delta} درجة منذ ${d} أيام.`,
    activity: `نشاط ${n} أقل من المعتاد بحوالي ${delta}٪ خلال الأسبوع الماضي (المعتاد حوالي ${base} خطوة يومي\u064Bا، ومؤخر\u064Bا حوالي ${cur}).`,
    night_restlessness: `حركة ${n} أثناء الليل أكثر من المعتاد بحوالي ${delta}٪ منذ ${d} ليال\u064D.`,
    bp_systolic: `متوسط ضغط الدم المسج\u0651ل (الرقم الأعلى) لدى ${n} أعلى من المعتاد بحوالي ${delta} مم زئبق هذا الأسبوع (المعتاد حوالي ${base}، ومؤخر\u064Bا حوالي ${cur}).`,
    glucose: `متوسط قراءات السكر المسج\u0651لة لدى ${n} أعلى من المعتاد بحوالي ${delta}٪ هذا الأسبوع.`,
  };
  return lang === 'en' ? en[f.metric] : ar[f.metric];
}

/** One-line push body. Deterministic (never AI) so it always fits and passes. */
export function pushTitle(metric: Metric, lang: Lang): string {
  return lang === 'en'
    ? `Trend Watch: ${METRIC_LABEL[metric].en}`
    : `متابعة التغي\u0651رات: ${METRIC_LABEL[metric].ar}`;
}

export function settledTemplate(metric: Metric, name: string, lang: Lang): string {
  return lang === 'en'
    ? `${name}'s ${METRIC_LABEL[metric].en.toLowerCase()} has been back within their usual range for 3 days.`
    : `عاد ${METRIC_LABEL[metric].ar} لدى ${name} إلى نطاقه المعتاد منذ 3 أيام.`;
}

/** Final text = body + blank line + disclaimer. Call AFTER the safety check. */
export function withDisclaimer(body: string, lang: Lang): string {
  return `${body.trim()}\n\n${DISCLAIMER[lang]}`;
}

// ------------------------------------------------------------ elder line
/**
 * The single gentle line on the elder's Home when they have opted in. Fixed
 * text only: no numbers, no metric jargon, nothing alarming.
 */
export const ELDER_LINE: Record<Metric, Record<Lang, string>> = {
  resting_hr: {
    en: 'Your heart worked a bit harder this week. Your family knows. Rest and drink water.',
    ar: 'قلبك اشتغل أكثر قليل\u064Bا هذا الأسبوع. عائلتك على علم. استرح واشرب الماء.',
  },
  spo2: {
    en: 'Your breathing readings were a little different this week. Your family knows. Take it easy.',
    ar: 'قراءات تنف\u0651سك كانت مختلفة قليل\u064Bا هذا الأسبوع. عائلتك على علم. خذ راحتك.',
  },
  skin_temp: {
    en: 'You felt a little warmer than usual this week. Your family knows. Drink water and rest.',
    ar: 'كنت أدفأ قليل\u064Bا من المعتاد هذا الأسبوع. عائلتك على علم. اشرب الماء واسترح.',
  },
  activity: {
    en: 'You moved a bit less this week. Your family knows. A short gentle walk can help.',
    ar: 'تحر\u0651كت أقل قليل\u064Bا هذا الأسبوع. عائلتك على علم. مشية قصيرة هادئة قد تفيدك.',
  },
  night_restlessness: {
    en: 'Your nights were a little restless this week. Your family knows. Try to rest well.',
    ar: 'كانت لياليك أقل هدوء\u064Bا هذا الأسبوع. عائلتك على علم. حاول أن ترتاح جيد\u064Bا.',
  },
  bp_systolic: {
    en: 'Your pressure readings were a bit higher this week. Your family knows. Rest and keep logging.',
    ar: 'قراءات الضغط كانت أعلى قليل\u064Bا هذا الأسبوع. عائلتك على علم. استرح واستمر في التسجيل.',
  },
  glucose: {
    en: 'Your sugar readings were a bit higher this week. Your family knows. Keep logging them.',
    ar: 'قراءات السكر كانت أعلى قليل\u064Bا هذا الأسبوع. عائلتك على علم. استمر في تسجيلها.',
  },
};

// --------------------------------------------------------- weekly summary
export type WeeklyMetricNumbers = {
  metric: Metric;
  thisWeek: number | null;
  lastWeek: number | null;
  thisMonth: number | null;
  lastMonth: number | null;
};

/** "higher than last week" / "about the same as last month" — a complete phrase. */
function comparePhrase(a: number | null, b: number | null, period: 'week' | 'month', lang: Lang): string {
  const when = {
    en: period === 'week' ? 'last week' : 'last month',
    ar: period === 'week' ? 'الأسبوع الماضي' : 'الشهر الماضي',
  }[lang];
  if (a == null || b == null) {
    return lang === 'en' ? `not enough readings to compare with ${when}` : `لا توجد قراءات كافية للمقارنة مع ${when}`;
  }
  const diff = a - b;
  const rel = b !== 0 ? Math.abs(diff / b) : 0;
  if (rel < 0.03) return lang === 'en' ? `about the same as ${when}` : `تقريب\u064Bا مثل ${when}`;
  if (diff > 0) return lang === 'en' ? `higher than ${when}` : `أعلى من ${when}`;
  return lang === 'en' ? `lower than ${when}` : `أقل من ${when}`;
}

/** 3–5 plain sentences built only from numbers. Used when the AI summary fails. */
export function weeklyTemplate(name: string, rows: WeeklyMetricNumbers[], lang: Lang): string {
  const usable = rows.filter((r) => r.thisWeek != null).slice(0, 4);
  if (usable.length === 0) {
    return lang === 'en'
      ? `There were not enough readings this week to compare ${name}'s week with the one before.`
      : `لم تكن هناك قراءات كافية هذا الأسبوع لمقارنة أسبوع ${name} بالأسبوع الذي قبله.`;
  }
  const lines = usable.map((r) => {
    const label = METRIC_LABEL[r.metric][lang];
    const w = comparePhrase(r.thisWeek, r.lastWeek, 'week', lang);
    const m = comparePhrase(r.thisMonth, r.lastMonth, 'month', lang);
    return lang === 'en' ? `${label}: ${w}, and ${m}.` : `${label}: ${w}، و${m}.`;
  });
  const intro = lang === 'en' ? `Here is ${name}'s week.` : `هذا ملخ\u0651ص أسبوع ${name}.`;
  return [intro, ...lines].join(' ');
}
