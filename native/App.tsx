// Salem — bare React Native entry (no Expo).
//
// Wires up: SafeArea + React Query providers, the auth bootstrap (zustand +
// Supabase auth events), the navigation stack (routes = the Expo app's paths,
// see src/navigation), sign-in deep links (salem://auth-callback), opening
// the right screen when a push is tapped, and the animated splash.
import { useEffect, useMemo, useState } from 'react';
import { Linking, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { bucketForRole, useAuthStore } from '@/stores/authStore';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { FallCheckOverlay } from '@/components/band/FallCheckOverlay';
import { isAuthLink } from '@/lib/authLink';
import { initOneSignal, onPushOpened, type PushOpenData } from '@/lib/oneSignal';
import { pushAction } from '@/lib/pushAction';
import { supabase } from '@/lib/supabase';
import { useForegroundTasks } from '@/lib/foreground';
import { PREVIEW_ENABLED } from '@/app/dev/preview';
import NotPorted from '@/navigation/NotPorted';
import { flushPendingNavigation, navigationRef, router, setPortedRoutes } from '@/navigation/router';
import { SCREENS, screenFor } from '@/navigation/screens';
import { colors } from '@/theme/tokens';

const Stack = createNativeStackNavigator();
const routes = Object.keys(SCREENS) as (keyof typeof SCREENS)[];
setPortedRoutes(routes);

// Tapping an alert push opens that role's alerts list (elders: notifications).
// If the tap launched the app, wait until sign-in has restored the role, then
// go just after the entry screen's own redirect so it doesn't replace us.
function openAlertsForRole() {
  const bucket = bucketForRole(useAuthStore.getState().role);
  if (bucket === 'family') router.push('/(family)/alerts');
  else if (bucket === 'doctor') router.push('/(doctor)/alerts');
  else if (bucket === 'elder') router.push('/notifications');
}
// A medicine reminder's buttons answer the dose (Taken / Not yet / Later, step32e)
// once the session is back, then open the elder home; a tap on the reminder itself
// just opens the elder home. A missed-dose push (step32f) and the low-mood notice
// (step32j) open the caregiver home; Rafiq's check-in opens the Rafiq chat.
function handlePush(data: PushOpenData, actionId: string | null) {
  const a = pushAction(data, actionId);
  if (a.kind === 'open_alerts') return openAlertsForRole();
  if (a.kind === 'open_rafiq') return router.push('/rafiq-chat');
  const answer = a.kind === 'dose_done'
    ? supabase.rpc('reminder_event_respond', { p_event_id: a.eventId, p_status: 'done', p_notes: null })
    : a.kind === 'dose_snooze'
      ? supabase.rpc('reminder_snooze', { p_event_id: a.eventId, p_kind: a.snooze })
      : Promise.resolve(null);
  void Promise.resolve(answer).finally(() => {
    void queryClient.invalidateQueries({ queryKey: ['elder-home-doses'] });
    const bucket = bucketForRole(useAuthStore.getState().role);
    if (bucket === 'elder') router.push('/(elder)');
    else if (bucket === 'family') router.push('/(family)');
  });
}
onPushOpened((data, actionId) => {
  const ready = (s: ReturnType<typeof useAuthStore.getState>) =>
    !s.bootstrapping && (!s.session || s.roleLoaded);
  if (ready(useAuthStore.getState())) return handlePush(data, actionId);
  const unsub = useAuthStore.subscribe((s) => {
    if (!ready(s)) return;
    unsub();
    setTimeout(() => handlePush(data, actionId), 500);
  });
});
void initOneSignal();

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const [entranceDone, setEntranceDone] = useState(false);
  const [navReady, setNavReady] = useState(false);
  useForegroundTasks();

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void bootstrap().then((c) => {
      cleanup = c;
    });
    return () => cleanup?.();
  }, [bootstrap]);

  // Password-reset / confirmation emails open salem://auth-callback…
  useEffect(() => {
    if (!navReady) return;
    const open = (url: string | null) => {
      if (url && isAuthLink(url)) router.push({ pathname: '/auth-callback', params: { url } });
      // Emulator test builds only: salem://dev/preview?screen=elder-home
      const m = url?.match(/^salem:\/\/dev\/preview(?:\?screen=([a-z-]+))?$/);
      if (m && PREVIEW_ENABLED) router.push({ pathname: '/dev/preview', params: { screen: m[1] ?? 'elder-home' } });
    };
    void Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, [navReady]);

  const screens = useMemo(
    () => routes.map((r) => <Stack.Screen key={r} name={r} component={screenFor(r)} />),
    [],
  );

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar barStyle="dark-content" />
        <NavigationContainer ref={navigationRef} onReady={() => {
            setNavReady(true);
            flushPendingNavigation();
          }}>
          <Stack.Navigator
            initialRouteName="/"
            screenOptions={{
              headerShown: false,
              animation: 'fade',
              contentStyle: { backgroundColor: colors.cream },
            }}
          >
            {screens}
            <Stack.Screen name="__not_ported__" component={NotPorted} />
          </Stack.Navigator>
        </NavigationContainer>
        {/* Elders only: "Are you OK?" when the band reports a fall. */}
        <FallCheckOverlay />
        {!entranceDone ? <AnimatedSplash onDone={() => setEntranceDone(true)} /> : null}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
