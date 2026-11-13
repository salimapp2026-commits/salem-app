# Push tap test (iOS simulator, no Apple account needed)

`sos-alert.apns` has the same shape as the push OneSignal delivers for an SOS
(`notify-fanout`: title, body, `data` → OneSignal's `custom.a`). All ids are
made up; nothing here talks to Supabase or OneSignal.

1. Sign in on the simulator with a family test account and tap **Allow** on
   the notifications prompt.
2. Send the sample alert (the app can be open, in the background or closed):

   ```bash
   xcrun simctl push booted com.salem.app native/scripts/push-test/sos-alert.apns
   ```

3. Tap the banner. Expected: the app opens **Family → Alerts**
   (doctors: Doctor → Alerts; elders: Notifications).

This only checks display + tap handling. Real delivery through Apple needs a
paid Apple Developer account (see docs/NATIVE_SCREEN_STATUS.md → Push).
