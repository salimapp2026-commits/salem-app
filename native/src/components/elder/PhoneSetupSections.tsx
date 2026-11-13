// Elder settings, Android: the two things set up once on the elder's phone
// (the real-phone checklist walks through both).
//   • Location for SOS — "while using the app" only; without it an SOS still
//     goes out, and the family sees that the location is missing.
//   • Band readings — Health Connect, read only, synced when the app opens.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, NativeModules, Platform, StyleSheet, Text } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { askLocationPermission, locationPermission, locationRationale, type LocationPermission } from '@/lib/currentPosition';
import {
  type HcAvailability,
  hcAvailability,
  hcConnect,
  hcConnected,
  hcLastSync,
  hcOpenSettings,
  hcSync,
  hcWriteTestReadings,
} from '@/lib/healthConnect';
import { formatDateTime, t, tf } from '@/lib/i18n';
import { colors, space, type } from '@/theme/tokens';

export function SosLocationSection() {
  const [state, setState] = useState<LocationPermission | null>(null);
  const refresh = useCallback(() => void locationPermission().then(setState), []);
  useEffect(refresh, [refresh]);
  if (Platform.OS !== 'android' || state === null || state === 'unavailable') return null;

  const allow = () => {
    const r = locationRationale();
    Alert.alert(r.title, r.body, [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('sosLocation.allow'),
        onPress: () => void askLocationPermission().then(setState),
      },
    ]);
  };

  return (
    <Card>
      <Text style={styles.title}>{t('sosLocation.row')}</Text>
      <Text style={[styles.body, state === 'granted' ? styles.ok : styles.warn]}>
        {t(state === 'granted' ? 'sosLocation.on' : 'sosLocation.off')}
      </Text>
      {state !== 'granted' ? (
        <>
          <Button label={t('sosLocation.allow')} onPress={allow} />
          <Button label={t('sosLocation.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
        </>
      ) : null}
    </Card>
  );
}

export function HealthConnectSection() {
  const [avail, setAvail] = useState<HcAvailability | null>(null);
  const [connected, setConnected] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const testTools = NativeModules.SalemApp?.testTools === true;

  const refresh = useCallback(async () => {
    const a = await hcAvailability();
    setAvail(a);
    setConnected(a === 'available' && (await hcConnected()));
    setLast(await hcLastSync());
  }, []);
  useEffect(() => void refresh(), [refresh]);
  if (avail === null || avail === 'unsupported') return null;

  const sync = async () => {
    setBusy(true);
    setMsg(t('hc.syncing'));
    try {
      const n = await hcSync();
      setMsg(tf('hc.synced', { n }));
    } catch {
      setMsg(t('hc.error'));
    } finally {
      setBusy(false);
      void refresh();
    }
  };
  const connect = async () => {
    setBusy(true);
    try {
      const ok = await hcConnect();
      setConnected(ok);
      if (ok) await sync();
      else setMsg(t('hc.denied'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={styles.title}>{t('hc.row')}</Text>
      <Text style={styles.body}>{t('hc.body')}</Text>
      <Text style={styles.body}>{t('hc.notSos')}</Text>
      {avail === 'needs_install' ? (
        <>
          <Text style={[styles.body, styles.warn]}>{t('hc.notInstalled')}</Text>
          <Button
            label={t('hc.install')}
            onPress={() => void Linking.openURL('https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata')}
          />
        </>
      ) : connected ? (
        <>
          <Text style={[styles.body, styles.ok]}>
            {last ? tf('hc.connected', { time: formatDateTime(new Date(last).toISOString()) }) : t('hc.never')}
          </Text>
          <Button label={t('hc.syncNow')} variant="secondary" onPress={() => void sync()} loading={busy} />
          <Button label={t('sosLocation.openSettings')} variant="secondary" onPress={hcOpenSettings} />
        </>
      ) : (
        <Button label={t('hc.connect')} onPress={() => void connect()} loading={busy} />
      )}
      {testTools && connected ? (
        <Button
          label="Emulator only: write 2 days of test readings"
          variant="secondary"
          onPress={() => void hcWriteTestReadings().then((n) => setMsg(`Wrote ${n} test records`), (e) => setMsg(String(e)))}
        />
      ) : null}
      {msg ? <Text style={styles.body}>{msg}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { ...type.subtitle, color: colors.textPrimary, textAlign: 'left', marginBottom: space.s },
  body: { ...type.body, color: colors.textSecondary, textAlign: 'left', marginBottom: space.s },
  ok: { color: colors.primary },
  warn: { color: colors.alertWarning },
});
