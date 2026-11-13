// Linking family members (native/src/lib/linkCode.ts): typed codes are cleaned the
// same way in both languages, every server answer has a plain message, and only the
// allowed roles can be added.
import { describe, expect, it } from 'vitest';
import { addChoices, cleanCode, remaining, shareText, statusKey } from '../native/src/lib/linkCode';

describe('linking: typing a code', () => {
  it('digits only, Arabic-Indic digits too, at most 4', () => {
    expect(cleanCode('48 27')).toBe('4827');
    expect(cleanCode('٤٨٢٧')).toBe('4827');
    expect(cleanCode('۴۸۲۷')).toBe('4827');
    expect(cleanCode('48271')).toBe('4827');
    expect(cleanCode('abc')).toBe('');
  });
  it('every server answer has a message; unknown ones get the generic one', () => {
    for (const s of ['invalid_or_expired', 'too_many_attempts', 'wrong_role', 'already_member', 'own_code']) {
      expect(statusKey(s)).not.toBe('link.err.generic');
    }
    expect(statusKey('something new')).toBe('link.err.generic');
    expect(statusKey(null)).toBe('link.err.generic');
  });
});

describe('linking: who can add whom', () => {
  it('the elder and a primary caretaker add caregivers or doctors; other caregivers bring in their parent; doctors add no one', () => {
    expect(addChoices('elder', false)).toEqual(['caregiver', 'doctor']);
    expect(addChoices('family', true)).toEqual(['caregiver', 'doctor']);
    expect(addChoices('family', false)).toEqual(['parent']);
    expect(addChoices('doctor', true)).toEqual([]);
  });
});

describe('linking: sharing and the countdown', () => {
  it('the shared text has the code, where to type it, and the 15 minutes', () => {
    expect(shareText('4827', 'en')).toMatch(/4827[\s\S]*Be invited[\s\S]*15 minutes/);
    expect(shareText('4827', 'ar')).toMatch(/4827[\s\S]*15 دقيقة/);
  });
  it('mm:ss until expiry, null after', () => {
    const now = Date.parse('2026-11-05T10:00:00Z');
    expect(remaining('2026-11-05T10:15:00Z', now)).toBe('15:00');
    expect(remaining('2026-11-05T10:00:59Z', now)).toBe('00:59');
    expect(remaining('2026-11-05T09:59:59Z', now)).toBeNull();
    expect(remaining(undefined, now)).toBeNull();
  });
});
