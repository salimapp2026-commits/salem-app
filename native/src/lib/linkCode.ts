// Linking family members with a typed code (step32b). Pure — no imports — so the
// wording rules are tested without a phone (tests/linkCode.test.ts).

export type JoinsAs = 'caregiver' | 'doctor' | 'parent';
export type LinkStatus =
  | 'ok' | 'invalid_or_expired' | 'too_many_attempts' | 'wrong_role' | 'already_member' | 'own_code';

/** What the person typed, digits only (Arabic-Indic digits too), at most 4. */
export function cleanCode(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '')
    .slice(0, 4);
}

/** The i18n key for a server status (anything unknown → the generic error). */
export function statusKey(status: string | null | undefined): string {
  switch (status) {
    case 'invalid_or_expired': return 'link.err.invalid';
    case 'too_many_attempts': return 'link.err.tooMany';
    case 'wrong_role': return 'link.err.wrongRole';
    case 'already_member': return 'link.err.already';
    case 'own_code': return 'link.err.own';
    default: return 'link.err.generic';
  }
}

/** Which roles this person may add (founder, 2026-11-01). Doctors add no one (L1).
 *  Only the elder and a primary caretaker add members to a circle; any other
 *  caregiver — with no elder yet, or a family member of someone's circle — can bring
 *  in their own parent (L2). */
export function addChoices(bucket: 'elder' | 'family' | 'doctor', isPrimary: boolean): JoinsAs[] {
  if (bucket === 'doctor') return [];
  if (bucket === 'elder') return ['caregiver', 'doctor'];
  return isPrimary ? ['caregiver', 'doctor'] : ['parent'];
}

/** The text sent with Share (WhatsApp etc.): the code, where to type it, how long it works. */
export function shareText(code: string, lang: 'ar' | 'en'): string {
  return lang === 'ar'
    ? `كود سليم: ${code}\nافتح تطبيق سليم ← «انضم بدعوة من فرد في العائلة» واكتب الكود. يعمل مرة واحدة لمدة 15 دقيقة.`
    : `Your Salem code: ${code}\nOpen Salem → “Be invited by a family member” and type the code. It works once, for 15 minutes.`;
}

/** mm:ss left, or null once expired. */
export function remaining(expiresAt: string | undefined, nowMs: number): string | null {
  if (!expiresAt) return null;
  const s = Math.floor((Date.parse(expiresAt) - nowMs) / 1000);
  if (s <= 0) return null;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
