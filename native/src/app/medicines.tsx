// Medicines — add a medicine with its times of day, see the current ones, stop one
// (step32i, founder 2026-11-04). For the elder (their own) and their primary
// caretaker (the elders they look after); everyone else is told who can. Each time
// becomes a daily reminder on the elder's phone (Taken / Not yet / Later), in the
// elder's time zone. Not in the Figma file (docs/DESIGN_DIFFERENCES.md).
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FieldCard, FieldEmpty, FieldScreen, SubHeader } from '@/components/dashboard';
import { Button } from '@/components/Button';
import { supabase } from '@/lib/supabase';
import { confirm } from '@/lib/confirm';
import { isolate, t, tf } from '@/lib/i18n';
import {
  addMedicine, addTime, elderIdsIManage, listMedicines, MAX_TIMES, type Medicine, parseTime, stopMedicine,
} from '@/lib/medicines';
import { bucketForRole, useAuthStore } from '@/stores/authStore';
import { colors, radius, space, touch, type } from '@/theme/tokens';

type Circle = { circle_id: string; elder_id: string; elder_name: string | null; is_elder: boolean };

const QUICK_TIMES = ['08:00', '14:00', '20:00'];

export default function Medicines() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user?.id);
  const isElder = bucketForRole(useAuthStore((s) => s.role)) === 'elder';

  const mine = useQuery({
    queryKey: ['medicine_elders', me, isElder],
    enabled: !!me,
    queryFn: () => elderIdsIManage(me!, isElder),
  });
  const circles = useQuery<Circle[]>({
    queryKey: ['my_circles'],
    enabled: !isElder,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_circles');
      if (error) throw error;
      return (data ?? []) as Circle[];
    },
  });
  const elders = useMemo(() => (mine.data ?? []).map((id) => ({
    id,
    name: (circles.data ?? []).find((c) => c.elder_id === id)?.elder_name ?? '',
  })), [mine.data, circles.data]);
  const [picked, setPicked] = useState<string | undefined>();
  const elderId = picked ?? elders[0]?.id;

  const meds = useQuery<Medicine[]>({
    queryKey: ['medicines', elderId],
    enabled: !!elderId,
    queryFn: () => listMedicines(elderId!),
  });

  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [times, setTimes] = useState<string[]>([]);
  const [timeText, setTimeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['medicines', elderId] });
    void qc.invalidateQueries({ queryKey: ['elder-home-doses', elderId] });
  };

  const pushTime = (raw: string) => {
    const tt = parseTime(raw);
    if (!tt) {
      setError(t('meds.badTime'));
      return;
    }
    setError(null);
    setTimes((cur) => addTime(cur, tt));
    setTimeText('');
  };

  const save = async () => {
    setError(null);
    setSaved(null);
    if (!elderId) return;
    if (!name.trim()) return setError(t('meds.needName'));
    if (!times.length) return setError(t('meds.needTime'));
    setBusy(true);
    try {
      await addMedicine(elderId, name, dose, times);
      setSaved(tf('meds.saved', { med: [name.trim(), dose.trim()].filter(Boolean).join(' ') }));
      setName('');
      setDose('');
      setTimes([]);
      refresh();
    } catch {
      setError(t('meds.failed'));
    } finally {
      setBusy(false);
    }
  };

  const askStop = (m: Medicine) => confirm({
    title: tf('meds.stopTitle', { med: m.title }),
    message: t('meds.stopBody'),
    confirmLabel: t('meds.stop'),
    cancelLabel: t('link.cancel'),
    destructive: true,
    onConfirm: () => {
      void stopMedicine(m).then(refresh, () => setError(t('meds.failed')));
    },
  });

  if (!me || mine.isLoading) {
    return (
      <FieldScreen>
        <SubHeader title={t('meds.title')} />
        <FieldEmpty text={t('common.loading')} />
      </FieldScreen>
    );
  }
  if (!elderId) {
    return (
      <FieldScreen>
        <SubHeader title={t('meds.title')} />
        <FieldEmpty text={t('meds.notAllowed')} />
      </FieldScreen>
    );
  }

  return (
    <FieldScreen>
      <SubHeader title={t('meds.title')} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {elders.length > 1 ? (
          <View style={styles.row}>
            {elders.map((e) => (
              <Pressable key={e.id} onPress={() => setPicked(e.id)}
                style={[styles.chip, e.id === elderId && styles.chipOn]} accessibilityRole="button">
                <Text style={[styles.chipText, e.id === elderId && styles.chipTextOn]}>{isolate(e.name || '—')}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {(meds.data ?? []).length === 0 && !meds.isLoading ? (
          <FieldEmpty text={t('meds.none')} />
        ) : null}
        {(meds.data ?? []).map((m) => (
          <FieldCard key={m.title} style={styles.medCard}>
            <View style={styles.medText}>
              <Text style={styles.medTitle}>{isolate(m.title)}</Text>
              <Text style={styles.medTimes}>{m.times.join('  ·  ')}</Text>
            </View>
            <Pressable onPress={() => askStop(m)} style={styles.stop} accessibilityRole="button"
              accessibilityLabel={tf('meds.stopTitle', { med: m.title })}>
              <Text style={styles.stopText}>{t('meds.stop')}</Text>
            </Pressable>
          </FieldCard>
        ))}

        <FieldCard style={styles.form}>
          <Text style={styles.formTitle}>{t('meds.add')}</Text>
          <Text style={styles.label}>{t('meds.name')}</Text>
          <TextInput value={name} onChangeText={setName} placeholder={t('meds.namePh')} maxLength={80}
            style={styles.input} placeholderTextColor={colors.textSecondary} textAlign="left" />
          <Text style={styles.label}>{t('meds.dose')}</Text>
          <TextInput value={dose} onChangeText={setDose} placeholder={t('meds.dosePh')} maxLength={40}
            style={styles.input} placeholderTextColor={colors.textSecondary} textAlign="left" />

          <Text style={styles.label}>{tf('meds.times', { max: MAX_TIMES })}</Text>
          <View style={styles.row}>
            {times.map((tt) => (
              <Pressable key={tt} onPress={() => setTimes((cur) => cur.filter((x) => x !== tt))}
                style={[styles.chip, styles.chipOn]} accessibilityRole="button"
                accessibilityLabel={tf('meds.removeTime', { time: tt })}>
                <Text style={[styles.chipText, styles.chipTextOn]}>{tt}  ✕</Text>
              </Pressable>
            ))}
            {QUICK_TIMES.filter((q) => !times.includes(q)).map((q) => (
              <Pressable key={q} onPress={() => pushTime(q)} style={styles.chip} accessibilityRole="button">
                <Text style={styles.chipText}>+ {q}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.timeRow}>
            <TextInput value={timeText} onChangeText={setTimeText} placeholder={t('meds.timePh')}
              keyboardType="numbers-and-punctuation" maxLength={5} onSubmitEditing={() => pushTime(timeText)}
              style={[styles.input, styles.timeInput]} placeholderTextColor={colors.textSecondary} textAlign="left" />
            <Pressable onPress={() => pushTime(timeText)} style={styles.addTime} accessibilityRole="button">
              <Text style={styles.addTimeText}>{t('meds.addTime')}</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {saved ? <Text style={styles.saved}>{saved}</Text> : null}
          <Button label={t('meds.save')} onPress={save} loading={busy} />
          <Text style={styles.hint}>{t('meds.hint')}</Text>
        </FieldCard>
      </ScrollView>
    </FieldScreen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.m, paddingBottom: space.xxl, gap: space.m },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: {
    minHeight: 44, paddingHorizontal: space.m, borderRadius: radius.xl, justifyContent: 'center',
    backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.primary,
  },
  chipOn: { backgroundColor: colors.primary },
  chipText: { ...type.body, color: colors.primary },
  chipTextOn: { color: colors.textInverse },
  medCard: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  medText: { flex: 1, gap: 4 },
  medTitle: { ...type.cardTitle, color: colors.textPrimary, textAlign: 'left' },
  medTimes: { ...type.body, color: colors.textSecondary, textAlign: 'left' },
  stop: { minHeight: touch.default, paddingHorizontal: space.m, justifyContent: 'center' },
  stopText: { ...type.body, color: colors.primary, textDecorationLine: 'underline' },
  form: { gap: space.s },
  formTitle: { ...type.cardTitle, color: colors.textPrimary, textAlign: 'left' },
  label: { ...type.caption, color: colors.textSecondary, textAlign: 'left', marginTop: space.s },
  input: {
    minHeight: touch.elderMin, backgroundColor: colors.cream, borderRadius: radius.xl,
    paddingHorizontal: space.l, paddingVertical: space.m, ...type.body, color: colors.textPrimary,
  },
  timeRow: { flexDirection: 'row', gap: space.s, alignItems: 'center' },
  timeInput: { flex: 1 },
  addTime: {
    minHeight: touch.elderMin, paddingHorizontal: space.l, borderRadius: radius.xl, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.primary,
  },
  addTimeText: { ...type.body, color: colors.primary },
  error: { ...type.body, color: colors.alertCritical, textAlign: 'left' },
  saved: { ...type.body, color: colors.textPrimary, textAlign: 'left' },
  hint: { ...type.caption, color: colors.textSecondary, textAlign: 'left' },
});
