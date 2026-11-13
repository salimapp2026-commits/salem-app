// Supabase client (bare React Native). URL and anon key are the PUBLIC values
// from the repo-root .env, inlined at build time by react-native-dotenv (see
// babel.config.js). The session lives in AsyncStorage, as in the current app.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_SUPABASE_URL } from '@env';

const rawUrl = EXPO_PUBLIC_SUPABASE_URL ?? '';
const rawKey = EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseConfigured = Boolean(rawUrl && rawKey);

// supabase-js throws at construction time if either value is empty; use a
// placeholder so the import resolves and the app can show a clear message.
const url = rawUrl || 'https://placeholder.invalid';
const anonKey = rawKey || 'placeholder-anon-key';

if (!supabaseConfigured) {
  console.warn('[salem] Supabase URL / anon key missing from .env — sign-in is blocked.');
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Sign-in links (password reset, email confirmation) arrive as deep links
    // (salem://auth-callback) and are handled in code, not from a URL bar.
    detectSessionInUrl: false,
  },
});
