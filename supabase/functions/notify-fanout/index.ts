// notify-fanout (verify_jwt: false). Internal-only: requires the caller's
// Authorization or apikey header to match SUPABASE_SERVICE_ROLE_KEY env.
// Resolves recipients via get_alert_recipients RPC and OneSignal-pushes each
// player ID, logging every send to notification_log. Falls back to in-app
// rows if OneSignal isn't configured.
//
// v4 (Trend Watch) — optional fields only; a caller that sends none of them
// (analyze-vitals) gets exactly the v3 behaviour:
//   • recipients: 'trend'   → route with get_trend_recipients instead of
//                              get_alert_recipients (warning reaches the doctor)
//   • exclude_roles: [...]  → drop these member roles (weekly summary skips doctors)
//   • texts: { en: {title, body}, ar: {title, body} }
//                            → per-recipient language, chosen by pickLanguage()
//   • in_app_only: true     → record an in-app notification, no push
//
// v5 (emergency alerts) — also optional:
//   • location: { url, text_en, text_ar }
//                            → "Last known location" line added to the PUSH of
//                              recipients allowed to see location (never doctors,
//                              any plan). notification_log keeps the body WITHOUT
//                              it: read-health members (doctors too) can read the
//                              whole log. See _shared/alertLocation.ts.
//   • location_recipients_only: true
//                            → send only to those recipients (the follow-up
//                              push when an SOS location arrives late).
//
// v6 (medicine reminders to the elder, step32e) — also optional:
//   • recipients: 'elder'   → send to the elder themself only (no caregivers)
//   • buttons, extra_data, ttl_seconds → see _shared/pushPayload.ts
//
// v8: accepts OneSignal's newer App API keys ("Key …") as well as the old ("Basic …").
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { bodyFor, isAlertLocation, locationAllowed } from '../_shared/alertLocation.ts';
import { isButtons, oneSignalAuth, oneSignalBody } from '../_shared/pushPayload.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
const ONESIGNAL_REST_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');

// The app UI is pinned to English (LOCALE_PINNED in lib/i18n.ts), so pushes go
// out in English for everyone. When Arabic is switched back on, set this to
// false and each recipient gets their own profile language.
const PUSH_LANGUAGE_PINNED_TO_ENGLISH = true;

type Lang = 'en' | 'ar';
type Texts = Record<Lang, { title: string; body: string }>;

function pickLanguage(recipientLocale: string | null | undefined): Lang {
  if (PUSH_LANGUAGE_PINNED_TO_ENGLISH) return 'en';
  return (recipientLocale ?? '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-salem-system-call',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function extractBearer(h: string | null): string | null {
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : h.trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const bearer = extractBearer(req.headers.get('Authorization'));
  const apikey = req.headers.get('apikey');
  if (bearer !== SUPABASE_SERVICE_ROLE && apikey !== SUPABASE_SERVICE_ROLE) {
    return json({ error: 'forbidden' }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const elder_id: string | undefined = body.elder_id;
    const severity: 'info' | 'warning' | 'critical' | undefined = body.severity;
    const source_kind: string = body.source_kind ?? 'system';
    const source_id: string | null = body.source_id ?? null;
    const title_ar: string | undefined = body.title_ar;
    const body_ar: string | undefined = body.body_ar;
    const texts: Texts | null = body.texts?.en && body.texts?.ar ? body.texts : null;
    const routeTrend = body.recipients === 'trend';
    const toElder = body.recipients === 'elder';
    const buttons = isButtons(body.buttons) ? body.buttons : null;
    const extraData = body.extra_data && typeof body.extra_data === 'object' ? body.extra_data as Record<string, unknown> : null;
    const ttlSeconds = typeof body.ttl_seconds === 'number' ? body.ttl_seconds : null;
    const excludeRoles: string[] = Array.isArray(body.exclude_roles) ? body.exclude_roles : [];
    const inAppOnly = body.in_app_only === true;
    const location = isAlertLocation(body.location) ? body.location : null;
    const locationOnly = body.location_recipients_only === true;

    if (!elder_id || !severity || !title_ar || !body_ar) {
      return json({ error: 'missing_fields' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const { data: recipientRows, error: recErr } = toElder
      ? await admin.from('profiles').select('id, preferred_locale').eq('id', elder_id)
        .then(({ data, error }) => ({
          data: (data ?? []).map((p: { id: string; preferred_locale: string | null }) =>
            ({ user_id: p.id, member_role: 'elder', locale: p.preferred_locale })),
          error,
        }))
      : await admin.rpc(
        routeTrend ? 'get_trend_recipients' : 'get_alert_recipients',
        { p_elder_id: elder_id, p_severity: severity },
      );
    if (recErr) return json({ error: 'recipients_failed', detail: recErr.message }, 500);

    const recipients = ((recipientRows ?? []) as { user_id: string; member_role: string; locale: string | null }[])
      .filter((r) => !excludeRoles.includes(r.member_role));

    // Location permission per recipient — only looked up for emergency alerts.
    const canSeeLocation = new Map<string, boolean>();
    if (location || locationOnly) {
      const { data: members } = await admin
        .from('care_circle_members')
        .select('user_id, member_role, can_read_location, care_circles!inner(elder_id)')
        .eq('care_circles.elder_id', elder_id)
        .eq('status', 'active')
        .in('user_id', recipients.map((r) => r.user_id));
      for (const m of (members ?? []) as { user_id: string; member_role: string; can_read_location: boolean }[]) {
        canSeeLocation.set(m.user_id, locationAllowed(m.member_role, m.can_read_location));
      }
    }

    const oneSignalReady = Boolean(ONESIGNAL_APP_ID && ONESIGNAL_REST_API_KEY);
    const results: unknown[] = [];

    for (const r of recipients) {
      const seesLocation = locationAllowed(r.member_role, canSeeLocation.get(r.user_id));
      if (locationOnly && !seesLocation) continue;
      // Per-recipient wording when the caller supplied both languages.
      const lang = pickLanguage(r.locale);
      const title = texts ? texts[lang].title : title_ar;
      const text = texts ? texts[lang].body : body_ar;
      // The push may carry the location; the log row (`text`) never does.
      const pushText = bodyFor(text, location, lang, seesLocation);

      if (inAppOnly) {
        await admin.rpc('record_notification', {
          p_elder_id: elder_id,
          p_recipient: r.user_id,
          p_channel: 'in_app',
          p_severity: severity,
          p_source_kind: source_kind,
          p_source_id: source_id,
          p_title_ar: title,
          p_body_ar: text,
          p_delivered: true,
          p_external_id: null,
          p_error: null,
        });
        results.push({ user_id: r.user_id, location: seesLocation && !!location, status: 'in_app', lang });
        continue;
      }

      const { data: tokens } = await admin
        .from('push_tokens')
        .select('onesignal_player_id')
        .eq('user_id', r.user_id);

      const playerIds = ((tokens ?? []) as { onesignal_player_id: string | null }[])
        .map((t) => t.onesignal_player_id)
        .filter((x): x is string => !!x);

      if (!oneSignalReady || playerIds.length === 0) {
        const reason = !oneSignalReady ? 'onesignal_not_configured' : 'no_player_ids';
        await admin.rpc('record_notification', {
          p_elder_id: elder_id,
          p_recipient: r.user_id,
          p_channel: 'in_app',
          p_severity: severity,
          p_source_kind: source_kind,
          p_source_id: source_id,
          p_title_ar: title,
          p_body_ar: text,
          p_delivered: false,
          p_external_id: null,
          p_error: reason,
        });
        results.push({ user_id: r.user_id, location: seesLocation && !!location, status: 'in_app_only', reason });
        continue;
      }

      try {
        const osResponse = await fetch('https://onesignal.com/api/v1/notifications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: oneSignalAuth(ONESIGNAL_REST_API_KEY!),
          },
          body: JSON.stringify(oneSignalBody({
            appId: ONESIGNAL_APP_ID!,
            playerIds,
            title,
            text: pushText,
            lang,
            critical: severity === 'critical',
            data: {
              elder_id, severity, source_kind, source_id,
              ...(seesLocation && location ? { location_url: location.url } : {}),
            },
            buttons,
            extraData,
            ttlSeconds,
          })),
        });
        const osData = await osResponse.json().catch(() => ({}));
        const success = osResponse.ok && Boolean(osData?.id);

        await admin.rpc('record_notification', {
          p_elder_id: elder_id,
          p_recipient: r.user_id,
          p_channel: 'push',
          p_severity: severity,
          p_source_kind: source_kind,
          p_source_id: source_id,
          p_title_ar: title,
          p_body_ar: text,
          p_delivered: success,
          p_external_id: osData?.id ?? null,
          p_error: success ? null : JSON.stringify(osData?.errors ?? osData ?? 'unknown'),
        });
        results.push({
          user_id: r.user_id,
          status: success ? 'sent' : 'failed',
          os_id: osData?.id ?? null,
        });
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        await admin.rpc('record_notification', {
          p_elder_id: elder_id,
          p_recipient: r.user_id,
          p_channel: 'push',
          p_severity: severity,
          p_source_kind: source_kind,
          p_source_id: source_id,
          p_title_ar: title,
          p_body_ar: text,
          p_delivered: false,
          p_external_id: null,
          p_error: msg,
        });
        results.push({ user_id: r.user_id, location: seesLocation && !!location, status: 'error', error: msg });
      }
    }

    return json({
      recipients_count: recipients.length,
      onesignal_configured: oneSignalReady,
      routing: toElder ? 'elder' : routeTrend ? 'trend' : 'alert',
      results,
    });
  } catch (e) {
    return json({ error: 'internal', detail: String((e as Error)?.message ?? e) }, 500);
  }
});
