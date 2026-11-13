// Auth helpers shared by sign-in / sign-up / auth-callback. These wrap a few
// supabase.auth calls so we can (a) compute the right redirect URL per
// platform and (b) detect Supabase's silent "user already exists" response —
// signUp returns a 200 with `data.user.identities.length === 0` instead of a
// hard error, to prevent email enumeration. We turn that into a real error so
// the UI can route the user to sign-in instead of silently dropping them.
import { supabase } from '@/lib/supabase';

export class EmailAlreadyRegisteredError extends Error {
  code = 'email_already_registered' as const;
  constructor() {
    super('email_already_registered');
    this.name = 'EmailAlreadyRegisteredError';
  }
}

// Where Supabase sends the user after a confirmation / reset email: the
// salem:// deep link (registered in Info.plist and AndroidManifest.xml). It
// must also be in Supabase Auth → URL configuration → Redirect URLs.
export function authRedirectTo(): string {
  return 'salem://auth-callback';
}

// Detect the device's IANA timezone (e.g. "Africa/Cairo", "Europe/London").
// Falls back to UTC if Intl.DateTimeFormat isn't available — should always
// resolve on Hermes 0.74+ and modern web. Used to seed profiles.timezone so
// reminders/AI assessments render in the user's local time.
function deviceTimezone(): string {
  return phoneTimezone() ?? 'UTC';
}

/** The phone's IANA time zone, or null if it can't be read (never guessed). */
export function phoneTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : null;
  } catch {
    return null;
  }
}

export async function signUpWithEmail(params: {
  email: string;
  password: string;
  displayName: string;
}) {
  const { data, error } = await supabase.auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      emailRedirectTo: authRedirectTo(),
      data: {
        display_name: params.displayName,
        // Forwarded into handle_new_user → profiles.timezone / preferred_locale.
        // Sending these explicitly avoids relying on the column-level defaults
        // and respects whatever the device is set to.
        timezone: deviceTimezone(),
      },
    },
  });
  if (error) throw error;
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    throw new EmailAlreadyRegisteredError();
  }
  return data;
}

// Passwordless sign-up used by the identity's create-account screen, which
// collects name + phone + email and no password. Supabase emails a magic link;
// clicking it lands on /auth-callback with a session, and handle_new_user seeds
// the profile from the metadata we attach here.
export async function signUpPasswordless(params: {
  email: string;
  displayName: string;
  phone?: string | null;
}) {
  const { error } = await supabase.auth.signInWithOtp({
    email: params.email,
    options: {
      emailRedirectTo: authRedirectTo(),
      shouldCreateUser: true,
      data: {
        display_name: params.displayName,
        phone_e164: params.phone || null,
        timezone: deviceTimezone(),
      },
    },
  });
  if (error) throw error;
}

export async function resetPasswordForEmail(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectTo(),
  });
  if (error) throw error;
}

export async function resendConfirmation(email: string) {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: authRedirectTo() },
  });
  if (error) throw error;
}

// Phone OTP — international-friendly E.164 normalization + send + verify.
// Requires the Supabase project's Phone provider to be configured in the
// dashboard (Twilio / MessageBird / Vonage). Without that, requestPhoneOtp
// throws.
//
// `normalizePhone` takes a country code (e.g. '+20', '+966', '+1') and a
// national-format local number, and combines them into canonical E.164.
// The local number is stripped of formatting (spaces, dashes, parens) and
// any leading 0 (a common national-prefix convention).
export function normalizePhone(localNumber: string, countryCode: string): string {
  const cc = countryCode.startsWith('+') ? countryCode : `+${countryCode}`;
  let s = localNumber.replace(/[\s\-()]/g, '');
  // If the user typed a full international number into the local field by
  // accident, accept it and ignore the picker.
  if (s.startsWith('00')) return '+' + s.slice(2);
  if (s.startsWith('+')) return s;
  if (s.startsWith('0')) s = s.slice(1);
  return cc + s;
}

export async function requestPhoneOtp(phoneE164: string) {
  const { error } = await supabase.auth.signInWithOtp({
    phone: phoneE164,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

// Returns the resolved session + a boolean telling the caller whether this is
// the user's first verified sign-in (no profile row yet). The caller uses
// that flag to decide whether to ask for a display name.
export async function verifyPhoneOtp(phoneE164: string, code: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    phone: phoneE164,
    token: code,
    type: 'sms',
  });
  if (error) throw error;
  if (!data.session || !data.user) {
    throw new Error('otp_no_session');
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('id', data.user.id)
    .maybeSingle();
  return {
    session: data.session,
    user: data.user,
    isFirstSignIn: !profile,
  };
}

// Create or update the profile row after a phone signup, once we have the
// display name. RLS allows self-update on profiles.id = auth.uid().
export async function ensureProfile(params: {
  userId: string;
  displayName: string;
  phoneE164?: string | null;
}) {
  const { error } = await supabase.from('profiles').upsert(
    {
      id: params.userId,
      display_name: params.displayName,
      phone_e164: params.phoneE164 ?? null,
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

// Translate a Supabase auth error into one of our i18n keys. Anything we don't
// recognize falls through to a generic message so we never surface raw English
// GoTrue strings to elders.
export function authErrorKey(err: unknown): string {
  const message = (err as { message?: string } | null)?.message ?? '';
  const code = (err as { code?: string } | null)?.code ?? '';
  const lower = message.toLowerCase();
  if (err instanceof EmailAlreadyRegisteredError || code === 'email_already_registered') {
    return 'auth.error.alreadyRegistered';
  }
  if (code === 'invalid_credentials' || lower.includes('invalid login credentials')) {
    return 'auth.error.invalid';
  }
  if (code === 'email_not_confirmed' || lower.includes('email not confirmed')) {
    return 'auth.error.emailNotConfirmed';
  }
  if (lower.includes('rate limit') || code === 'over_email_send_rate_limit') {
    return 'auth.error.rateLimited';
  }
  if (lower.includes('network')) {
    return 'auth.error.network';
  }
  if (code === 'otp_expired' || lower.includes('otp_expired') || lower.includes('expired')) {
    return 'auth.error.otpExpired';
  }
  if (code === 'invalid_otp' || lower.includes('invalid token') || lower.includes('invalid_otp')) {
    return 'auth.error.otpInvalid';
  }
  if (lower.includes('phone') && lower.includes('provider')) {
    return 'auth.error.phoneProviderMissing';
  }
  return 'auth.error.unknown';
}
