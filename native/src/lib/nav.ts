// Navigation helpers. The defining problem these solve: `router.back()` is a
// no-op when there's no history — which happens whenever the user lands on
// a sub-screen via a direct URL/reload (very common in web dev / shared
// links). Use `safeBack()` for every back button so the user always has an
// escape: fall through to "/" and let the root redirect funnel send them
// to the right role home.
import { router } from '@/navigation/router';

export function safeBack() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/');
  }
}
