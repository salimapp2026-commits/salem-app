// Auth + role state. Hydrated from Supabase auth events; the user's chosen
// role lives in the profiles table (we mirror it here for routing decisions).
//
// Push integration: on every authenticated session we kick off
// `requestPushPermission(userId)` which (a) inits the OneSignal SDK lazily,
// (b) asks the browser for notification permission if not yet granted, and
// (c) writes the resulting subscription id to push_tokens for notify-fanout
// to find. Sign-out logs the OneSignal session out so the next user starts
// clean. All push helpers no-op when EXPO_PUBLIC_ONESIGNAL_APP_ID is unset.
import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { forgetThisDevice, logoutOneSignal, requestPushPermission } from '@/lib/oneSignal';
import { resetShareLocation } from '@/lib/shareLocation';

// Mirror of the public.app_role enum (admin, caretaker, doctor, elder, family).
export type AppRole = 'elder' | 'family' | 'caretaker' | 'doctor' | 'admin';

// Routing bucket: family + caretaker share the same dashboard, admin sees the
// family dashboard until we build a dedicated admin surface.
export type RoleBucket = 'elder' | 'family' | 'doctor';

// Waits before each attempt to read the signed-in user's role (refreshRole).
export const ROLE_READ_DELAYS_MS = [0, 500, 1000, 2000, 4000];

export function bucketForRole(role: AppRole | null): RoleBucket | null {
  if (!role) return null;
  if (role === 'elder') return 'elder';
  if (role === 'doctor') return 'doctor';
  return 'family';
}

type AuthState = {
  bootstrapping: boolean;
  // True once the person has actually picked a role. profiles.role defaults to
  // 'elder', so the role column alone can't answer "have they chosen?" — the
  // role_chosen_at stamp does. Choosing is one-time and permanent.
  roleChosen: boolean;
  // False from the moment a (new) user's session arrives until their role row
  // has been fetched. The auth gate waits on this so a fresh sign-in isn't
  // mistaken for "no role yet" and bounced to the role-select screen.
  roleLoaded: boolean;
  // True when a signed-in user's role could not be read (no network, or an expired
  // session still refreshing). The gate then offers "Try again" — never role-select,
  // where choosing would overwrite the role they already have.
  roleReadFailed: boolean;
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  setSession: (session: Session | null) => void;
  setRole: (role: AppRole | null) => void;
  signOut: () => Promise<void>;
  refreshRole: () => Promise<void>;
  retryRole: () => Promise<void>;
  bootstrap: () => Promise<() => void>;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  bootstrapping: true,
  roleChosen: false,
  roleLoaded: true,
  roleReadFailed: false,
  session: null,
  user: null,
  role: null,

  setSession: (session) =>
    set({ session, user: session?.user ?? null }),

  setRole: (role) => set({ role }),

  signOut: async () => {
    await forgetThisDevice();   // while still signed in: RLS lets us remove our own row
    await supabase.auth.signOut();
    resetShareLocation();
    set({ session: null, user: null, role: null, roleChosen: false, roleReadFailed: false });
    void logoutOneSignal();
  },

  refreshRole: async () => {
    const userId = get().user?.id;
    if (!userId) {
      set({ role: null, roleChosen: false });
      return;
    }

    // A signed-in user must always read back their own profile row. If the row
    // comes back missing we do NOT conclude "no role" — an unauthenticated
    // request is filtered to zero rows by RLS and looks identical to a genuine
    // first-run profile. Treating that as "no role" sends an existing user to
    // role-select, where choosing overwrites the role they already had.
    //
    // On a cold start after the access token expired, the refresh can still be in
    // flight (or the network not up yet): getSession() then has no session and the
    // read would go out without a token. So wait for a session, for up to ~7 s.
    for (const delay of ROLE_READ_DELAYS_MS) {
      if (delay) await new Promise<void>((r) => setTimeout(r, delay));
      if (get().user?.id !== userId) return; // signed out or switched meanwhile
      const { data: current } = await supabase.auth.getSession();
      if (!current.session) continue;

      const { data, error } = await supabase
        .from('profiles')
        .select('role, role_chosen_at')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data) {
        set({
          role: (data.role as AppRole | null) ?? null,
          roleChosen: !!data.role_chosen_at,
          roleReadFailed: false,
        });
        return;
      }
    }

    // Genuinely could not read a row. Keep a role we already had; otherwise tell
    // the gate, which offers "Try again". The next token refresh (auth listener
    // below) reads again by itself.
    if (get().role === null) set({ roleReadFailed: true });
  },

  retryRole: async () => {
    set({ roleLoaded: false, roleReadFailed: false });
    await get().refreshRole();
    set({ roleLoaded: true });
  },

  bootstrap: async () => {
    const { data } = await supabase.auth.getSession();
    // Mark the role as still-loading BEFORE clearing `bootstrapping`, otherwise
    // the auth gate gets one render where the session exists and role is null,
    // and sends an already-onboarded user to role-select.
    set({
      session: data.session,
      user: data.session?.user ?? null,
      roleLoaded: !data.session?.user,
      bootstrapping: false,
    });
    if (data.session?.user) {
      await get().refreshRole();
      set({ roleLoaded: true });
      void requestPushPermission(data.session.user.id);
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const previousUserId = get().user?.id;
      // Only flag the role as "loading" when the signed-in user actually
      // changes — token refreshes for the same user must not flash the gate.
      const userChanged = !!session?.user && session.user.id !== previousUserId;
      set({
        session,
        user: session?.user ?? null,
        ...(userChanged ? { roleLoaded: false } : {}),
      });
      if (session?.user) {
        // Deferred out of the callback: supabase-js holds an internal auth lock
        // while this handler runs, so a query issued here can go out before the
        // new token is applied and come back RLS-filtered to nothing.
        const uid = session.user.id;
        setTimeout(() => {
          void get()
            .refreshRole()
            .finally(() => set({ roleLoaded: true }));
          void requestPushPermission(uid);
        }, 0);
      } else {
        set({ role: null, roleChosen: false, roleLoaded: true, roleReadFailed: false });
      }
    });

    return () => sub.subscription.unsubscribe();
  },
}));
