// Sign-in links on the phone (replaces the web app's "read the address bar").
//
// Supabase's confirmation / password-reset emails open
//   salem://auth-callback#access_token=…&refresh_token=…&type=recovery
// or, with the PKCE flow,
//   salem://auth-callback?code=…
// and on failure
//   salem://auth-callback?error=…&error_description=…
// This turns that URL into a session (or a readable error).
import { supabase } from '@/lib/supabase';

export type AuthLinkResult =
  | { kind: 'recovery' }
  | { kind: 'signed_in' }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

function paramsOf(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = [url.split('#')[1] ?? '', (url.split('?')[1] ?? '').split('#')[0]];
  for (const part of parts) {
    for (const kv of part.split('&').filter(Boolean)) {
      const [k, v = ''] = kv.split('=');
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
  }
  return out;
}

export function isAuthLink(url: string | null | undefined): boolean {
  return !!url && /^salem:\/\/auth-callback/i.test(url);
}

export async function handleAuthLink(url: string): Promise<AuthLinkResult> {
  const p = paramsOf(url);
  if (p.error || p.error_description) {
    return { kind: 'error', message: p.error_description || p.error };
  }
  if (p.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(p.code);
    if (error) return { kind: 'error', message: error.message };
    return p.type === 'recovery' ? { kind: 'recovery' } : { kind: 'signed_in' };
  }
  if (p.access_token && p.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: p.access_token,
      refresh_token: p.refresh_token,
    });
    if (error) return { kind: 'error', message: error.message };
    return p.type === 'recovery' ? { kind: 'recovery' } : { kind: 'signed_in' };
  }
  return { kind: 'none' };
}
