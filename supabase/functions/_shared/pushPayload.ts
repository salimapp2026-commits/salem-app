// The OneSignal request body for one recipient (notify-fanout). Pure — no imports — so
// it is tested without Deno (tests/pushPayload.test.ts).
//
// v6 (medicine reminders to the elder, step32e) adds, all optional:
//   • buttons: [{ id, en, ar }]  → action buttons in the recipient's language
//                                  (Taken / Not yet / Later); the tap reaches the app
//                                  as the click's actionId
//   • extra_data: {...}          → merged into the push data (e.g. { event_id })
//   • ttl_seconds                → a push older than this is not delivered (a dose
//                                  reminder is useless an hour later)

export type Lang = 'en' | 'ar';
export type PushButton = { id: string; en: string; ar: string };

export function isButtons(v: unknown): v is PushButton[] {
  return Array.isArray(v) && v.length > 0 && v.length <= 3 && v.every((b) =>
    b && typeof b === 'object' && typeof (b as PushButton).id === 'string'
    && typeof (b as PushButton).en === 'string' && typeof (b as PushButton).ar === 'string');
}

export function oneSignalBody(p: {
  appId: string;
  playerIds: string[];
  title: string;
  text: string;
  lang: Lang;
  critical: boolean;
  data: Record<string, unknown>;
  buttons?: PushButton[] | null;
  extraData?: Record<string, unknown> | null;
  ttlSeconds?: number | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    app_id: p.appId,
    include_player_ids: p.playerIds,
    headings: { en: p.title, ar: p.title },
    contents: { en: p.text, ar: p.text },
    priority: p.critical ? 10 : 5,
    data: { ...(p.extraData ?? {}), ...p.data },
  };
  if (p.buttons && p.buttons.length) {
    body.buttons = p.buttons.map((b) => ({ id: b.id, text: p.lang === 'ar' ? b.ar : b.en }));
  }
  if (typeof p.ttlSeconds === 'number' && p.ttlSeconds > 0) body.ttl = Math.round(p.ttlSeconds);
  return body;
}

// OneSignal's newer App API keys ("os_v2_app_…", the only kind the dashboard makes now)
// sign in with "Key …"; the older REST keys with "Basic …".
export function oneSignalAuth(restKey: string): string {
  const k = restKey.trim();
  return k.startsWith('os_v2_') ? `Key ${k}` : `Basic ${k}`;
}
