// Push token registration helper. Persists a OneSignal player id (or any
// equivalent provider token) for the current user so the notify-fanout edge
// function can find it via the push_tokens table.
//
// This file intentionally does NOT pull in expo-notifications or the
// OneSignal SDK — wiring the actual push provider is a device-only concern
// best handled when running on a real device. Once the OneSignal SDK is
// integrated, hook its onPlayerIdReceived callback to call registerPushToken().
//
// Schema (from supabase): push_tokens has UNIQUE(user_id, onesignal_player_id)
// and UNIQUE(user_id, token). platform must be one of ios|android|web.
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

const SUPPORTED: ReadonlyArray<'ios' | 'android' | 'web'> = ['ios', 'android', 'web'];

function platformValue(): 'ios' | 'android' | 'web' {
  return (SUPPORTED as readonly string[]).includes(Platform.OS)
    ? (Platform.OS as 'ios' | 'android' | 'web')
    : 'web';
}

export async function registerPushToken(params: {
  userId: string;
  oneSignalPlayerId?: string;
  expoPushToken?: string;
}) {
  const { userId, oneSignalPlayerId, expoPushToken } = params;
  if (!oneSignalPlayerId && !expoPushToken) return;

  const row = {
    user_id: userId,
    platform: platformValue(),
    onesignal_player_id: oneSignalPlayerId ?? null,
    token: expoPushToken ?? null,
    last_seen_at: new Date().toISOString(),
  };

  // Pick the unique-constraint that actually applies for this row so the
  // upsert resolves cleanly. If both ids are present we prefer the OneSignal
  // path because that's what notify-fanout reads.
  const onConflict = oneSignalPlayerId
    ? 'user_id,onesignal_player_id'
    : 'user_id,token';

  const { error } = await supabase.from('push_tokens').upsert(row, { onConflict });
  if (error) {
    // Surface but don't throw — push registration failure should never block
    // the app from rendering.
    console.warn('[salem] push token upsert failed', error.message);
  }
}
