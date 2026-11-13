// "Last known location" on emergency alerts (SOS and falls).
//
// Rules — same for manual SOS and the band:
//   • Only circle members with the location permission see it, on every plan
//     (FREE included): live tracking may be paid, the location of an emergency
//     is not.
//   • Doctors never see it, whatever their permissions say.
//   • It goes in the push, never in notification_log: circle members with
//     read-health (doctors too) can read every row of an elder's log.
//
// Pure functions, used by notify-fanout and covered by tests/alertLocation.test.ts.

export type AlertLocation = {
  url: string;      // https://maps.google.com/?q=lat,lon
  text_en: string;  // "Last known location (10:42): https://…"
  text_ar: string;
};

export function isAlertLocation(x: unknown): x is AlertLocation {
  const l = x as AlertLocation;
  return !!l && typeof l.url === 'string' && /^https:\/\//.test(l.url)
    && typeof l.text_en === 'string' && typeof l.text_ar === 'string';
}

export function locationAllowed(memberRole: string | null | undefined, canReadLocation: boolean | null | undefined): boolean {
  return memberRole !== 'doctor' && canReadLocation === true;
}

/** The push body for one recipient: with the location line only if allowed. */
export function bodyFor(
  body: string,
  location: AlertLocation | null,
  lang: 'en' | 'ar',
  allowed: boolean,
): string {
  if (!location || !allowed) return body;
  return `${body}\n${lang === 'ar' ? location.text_ar : location.text_en}`;
}

/** Maps link for a coordinate pair (rounded to ~1 m). */
export function mapsUrl(lat: number, lon: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(5)},${lon.toFixed(5)}`;
}
