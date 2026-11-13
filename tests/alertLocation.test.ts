import { describe, expect, it } from 'vitest';
import { bodyFor, isAlertLocation, locationAllowed, mapsUrl } from '../supabase/functions/_shared/alertLocation.ts';

const loc = {
  url: 'https://maps.google.com/?q=30.04440,31.23570',
  text_en: 'Last known location (10:42): https://maps.google.com/?q=30.04440,31.23570',
  text_ar: 'آخر موقع معروف (10:42): https://maps.google.com/?q=30.04440,31.23570',
};

describe('who sees an emergency location', () => {
  it('caregiver with the location permission: yes', () => {
    expect(locationAllowed('primary_caretaker', true)).toBe(true);
    expect(locationAllowed('family', true)).toBe(true);
  });
  it('caregiver without it: no', () => {
    expect(locationAllowed('family', false)).toBe(false);
    expect(locationAllowed('family', null)).toBe(false);
  });
  it('doctor: never, even if the flag were set', () => {
    expect(locationAllowed('doctor', true)).toBe(false);
  });
});

describe('push body', () => {
  it('adds the location line only for allowed recipients', () => {
    expect(bodyFor('SOS from Samira.', loc, 'en', true)).toBe(`SOS from Samira.\n${loc.text_en}`);
    expect(bodyFor('SOS from Samira.', loc, 'ar', true)).toContain('آخر موقع معروف');
    expect(bodyFor('SOS from Samira.', loc, 'en', false)).toBe('SOS from Samira.');
  });
  it('no location known: body unchanged', () => {
    expect(bodyFor('SOS from Samira.', null, 'en', true)).toBe('SOS from Samira.');
  });
  it('validates the shape sent by the database', () => {
    expect(isAlertLocation(loc)).toBe(true);
    expect(isAlertLocation({ ...loc, url: 'javascript:alert(1)' })).toBe(false);
    expect(isAlertLocation(null)).toBe(false);
  });
  it('maps link', () => {
    expect(mapsUrl(30.0444, 31.2357)).toBe('https://maps.google.com/?q=30.04440,31.23570');
  });
});
