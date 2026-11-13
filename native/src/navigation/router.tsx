// expo-router-compatible navigation on top of React Navigation.
//
// The Expo app navigates with file paths ('/(elder)/vitals', '/messages/[id]'
// with params). To keep every ported screen's changes small, this layer offers
// the same calls — useRouter().push/replace/back/canGoBack, useLocalSearchParams,
// useFocusEffect, <Redirect>, <Link> and a global `router` — and maps each path
// to a React Navigation screen. A path whose screen isn't ported yet opens the
// "still on the old app" placeholder instead of crashing.
import { useEffect, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import {
  createNavigationContainerRef,
  StackActions,
  useFocusEffect as rnUseFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';

/** Every route of the Expo app (groups kept, as the screens use them). */
export const ROUTES = [
  '/',
  '/(auth)/sign-in',
  '/(auth)/sign-up',
  '/(auth)/phone-sign-in',
  '/auth-callback',
  '/(onboarding)/role-select',
  '/(elder)',
  '/(elder)/vitals',
  '/(elder)/more',
  '/(family)/more',
  '/dev/preview',
  '/(elder)/reminders',
  '/(elder)/prescriptions',
  '/rafiq',
  '/rafiq-chat',
  '/medicines',
  '/messages',
  '/messages/[id]',
  '/(family)',
  '/(family)/alerts',
  '/(family)/circle',
  '/(family)/visits',
  '/location',
  '/trends/[elderId]',
  '/(doctor)',
  '/(doctor)/patient/[id]',
  '/(doctor)/prescribe',
  '/(doctor)/visit/new',
  '/(doctor)/visit/[visitId]',
  '/(doctor)/alerts',
  '/notifications',
  '/settings',
  '/plans',
  '/legal/privacy',
  '/legal/terms',
  '/pair',
  '/link/add',
  '/link/join',
  '/redeem-invite',
] as const;

export type RouteName = (typeof ROUTES)[number] | '__not_ported__';
export type Params = Record<string, string | undefined>;
export type Href = string | { pathname: string; params?: Record<string, string | number | undefined> };

export const navigationRef = createNavigationContainerRef<Record<string, Params | undefined>>();

/** Set by the navigator: which routes have a real (ported) screen. */
let ported = new Set<string>();
export function setPortedRoutes(names: string[]) {
  ported = new Set(names);
}

function split(p: string) {
  return p.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean);
}

/** '/(doctor)/patient/123' or {pathname:'/(doctor)/patient/[id]', params} → route + params. */
export function resolve(href: Href): { name: RouteName; params: Params; path: string } {
  const pathname = typeof href === 'string' ? href : href.pathname;
  const extra: Params = {};
  if (typeof href !== 'string') {
    for (const [k, v] of Object.entries(href.params ?? {})) extra[k] = v == null ? undefined : String(v);
  }
  const query = typeof href === 'string' && href.includes('?') ? href.split('?')[1] : '';
  for (const kv of query.split('&').filter(Boolean)) {
    const [k, v = ''] = kv.split('=');
    extra[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  const segs = split(pathname);
  for (const route of ROUTES) {
    const rsegs = split(route);
    if (rsegs.length !== segs.length) continue;
    const params: Params = { ...extra };
    let ok = true;
    rsegs.forEach((r, i) => {
      if (!ok) return;
      const m = r.match(/^\[(.+)\]$/);
      if (m) params[m[1]] = segs[i].startsWith('[') ? params[m[1]] : decodeURIComponent(segs[i]);
      else if (r !== segs[i]) ok = false;
    });
    if (ok) return { name: route, params, path: pathname };
  }
  return { name: '__not_ported__', params: { path: pathname }, path: pathname };
}

function target(href: Href) {
  const r = resolve(href);
  if (r.name !== '__not_ported__' && !ported.has(r.name)) {
    return { name: '__not_ported__' as const, params: { path: r.name } };
  }
  return r;
}

// Screens can navigate before the container is ready (e.g. the auth gate's
// first <Redirect>); keep the latest call and replay it from onReady.
let pending: { kind: 'push' | 'replace'; href: Href } | null = null;
export function flushPendingNavigation() {
  const p = pending;
  pending = null;
  if (p) go(p.kind, p.href);
}

function go(kind: 'push' | 'replace', href: Href) {
  if (!navigationRef.isReady()) {
    pending = { kind, href };
    return;
  }
  const t = target(href);
  if (kind === 'push') navigationRef.dispatch(StackActions.push(t.name, t.params));
  else navigationRef.dispatch(StackActions.replace(t.name, t.params));
}

export const router = {
  push: (href: Href) => go('push', href),
  replace: (href: Href) => go('replace', href),
  back: () => {
    if (navigationRef.isReady() && navigationRef.canGoBack()) navigationRef.goBack();
    else go('replace', '/');
  },
  canGoBack: () => navigationRef.isReady() && navigationRef.canGoBack(),
};

export function useRouter() {
  useNavigation(); // re-render with navigation state, as expo-router does
  return router;
}

export function useLocalSearchParams<T extends Params = Params>(): T {
  return ((useRoute().params ?? {}) as T);
}

export const useFocusEffect = rnUseFocusEffect;

export function Redirect({ href }: { href: Href }) {
  useEffect(() => {
    router.replace(href);
  }, [typeof href === 'string' ? href : href.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function Link({
  href,
  children,
  replace,
  style,
  asChild: _asChild,
}: {
  href: Href;
  children: ReactNode;
  replace?: boolean;
  style?: StyleProp<ViewStyle>;
  asChild?: boolean;
}) {
  return (
    <Pressable style={style} accessibilityRole="link" onPress={() => (replace ? router.replace(href) : router.push(href))}>
      {children}
    </Pressable>
  );
}
