// Public build-time values from the repo-root .env (see babel.config.js).
declare module '@env' {
  export const EXPO_PUBLIC_SUPABASE_URL: string | undefined;
  export const EXPO_PUBLIC_SUPABASE_ANON_KEY: string | undefined;
  export const EXPO_PUBLIC_ONESIGNAL_APP_ID: string | undefined;
}
