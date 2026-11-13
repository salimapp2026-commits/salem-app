// Rafiq — the chat. Figma "05 · Rafiq text conversation" (115:117) and
// "04 · Rafiq voice and mood" (115:15), with the founder's changes (Q4): no video,
// microphone, emoji or image buttons; the phone icon opens the dialer to the
// caregiver; "talk" is read-aloud plus mood (no voice input).
//
// Phase 1 is our own logic only (lib/rafiqChat): replies from real data or a kind
// "I don't know" with suggestion chips — never an invented medical answer. Rafiq
// starts the conversation with medicine reminders and the morning / evening check-in.
// Conversations stay on this phone; caregivers see only the mood (founder, 4g).
//
// The elder talks about themselves; caregivers and doctors ask about the elder they
// look after (Rafiq's details screen, /rafiq, is one tap away).
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from '@/navigation/router';
import { safeBack } from '@/lib/nav';
import { SosButton } from '@/components/SosButton';
import {
  ChevronLeftIcon, KeyboardIcon, PhoneIcon, PhoneOffIcon, SendIcon, SpeakerIcon,
} from '@/components/icons';
import { supabase } from '@/lib/supabase';
import { useRafiqCard } from '@/lib/rafiq';
import { useCircleCorners, useElderStats, useTodayDoses } from '@/lib/elderHomeData';
import { dialable, elderDoses } from '@/lib/elderHome';
import { shortWhen } from '@/components/VitalCards';
import { useSelfProfile } from '@/lib/useSelfProfile';
import { useMoodNotice } from '@/lib/moodNotice';
import { formatTime, getLocale, t, tf } from '@/lib/i18n';
import type { ChatContext, Chip } from '@/lib/rafiqChat/engine';
import { type StoredMsg, useRafiqChat } from '@/lib/rafiqChat/useRafiqChat';
import { speak, speechAvailable, stopSpeaking, useSpeaking } from '@/lib/speech';
import { bucketForRole, useAuthStore } from '@/stores/authStore';
import { colors, radius, textStyle, type TextToken } from '@/theme/tokens';

type Circle = { circle_id: string; elder_id: string; elder_name: string | null; is_elder: boolean };
const firstName = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? '';

export default function RafiqChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ elderId?: string }>();
  const userId = useAuthStore((s) => s.user?.id);
  const role = useAuthStore((s) => bucketForRole(s.role)) ?? 'family';
  const isElder = role === 'elder';
  const lang = getLocale() === 'ar' ? 'ar' : 'en';

  const self = useSelfProfile();
  const moodNotice = useMoodNotice(userId, isElder);
  const circles = useQuery<Circle[]>({
    queryKey: ['my_circles'],
    enabled: !isElder,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_circles');
      if (error) throw error;
      return (data ?? []) as Circle[];
    },
  });
  const elders = useMemo(() => (circles.data ?? []).filter((c) => !c.is_elder), [circles.data]);
  const [picked, setPicked] = useState<string | undefined>(params.elderId);
  const subject = isElder ? userId : (picked ?? elders[0]?.elder_id);
  const subjectName = isElder ? firstName(self.data?.display_name)
    : firstName(elders.find((e) => e.elder_id === subject)?.elder_name);

  const doseRows = useTodayDoses(subject);
  const stats = useElderStats(subject);
  const card = useRafiqCard(subject);
  const corners = useCircleCorners(isElder ? userId : undefined);
  const elderPhone = useQuery({
    queryKey: ['rafiq_chat_elder_phone', subject],
    enabled: !isElder && role === 'family' && !!subject,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('phone_e164').eq('id', subject!).maybeSingle();
      return dialable((data?.phone_e164 as string | null | undefined) ?? null);
    },
  });

  // Recomputed each minute so a dose turns "due" while the chat is open.
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const id = setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 30_000);
    return () => clearInterval(id);
  }, []);
  const doses = useMemo(
    () => (doseRows.data ? elderDoses(doseRows.data, minute * 60_000).doses : null),
    [doseRows.data, minute],
  );

  const ready = !!userId && !!subject && (doseRows.isFetched || doseRows.isError);
  const ctx: ChatContext | null = useMemo(() => (ready ? {
    role,
    lang,
    me: firstName(self.data?.display_name),
    name: subjectName,
    doses,
    stats: stats.data ?? null,
    card: card.data ?? null,
    fmtTime: (iso) => formatTime(iso),
    fmtWhen: (iso) => shortWhen(iso),
  } : null), [ready, role, lang, self.data?.display_name, subjectName, doses, stats.data, card.data]);

  const chat = useRafiqChat(userId, subject, ctx);

  const caregiverPhone = dialable(corners.data?.caregiver?.phone_e164 ?? null);
  const dialNumber = isElder ? caregiverPhone : elderPhone.data ?? null;
  const dial = (n: string | null) => n && Linking.openURL(`tel:${n}`);

  const onChip = (chip: Chip) => {
    const of = !isElder && subjectName;
    if (chip === 'meds') chat.ask('meds', of ? tf('rc.chip.medsOf', { name: subjectName }) : t('rc.chip.meds'));
    if (chip === 'readings') chat.ask('readings', of ? tf('rc.chip.readingsOf', { name: subjectName }) : t('rc.chip.readings'));
    if (chip === 'mood') chat.askMood(t('rc.chip.mood'));
    if (chip === 'help') chat.ask('help', t('rc.chip.help'));
    if (chip === 'insights' && subject) router.push({ pathname: '/rafiq', params: { elderId: subject } });
    if (chip === 'call') dial(caregiverPhone);
  };

  const noElder = !isElder && circles.isFetched && elders.length === 0;

  return (
    <RafiqChatView
      isElder={isElder}
      lang={lang}
      msgs={chat.msgs}
      loading={!chat.loaded || (!ctx && !noElder)}
      noElder={noElder}
      elders={isElder ? [] : elders.map((e) => ({ id: e.elder_id, name: firstName(e.elder_name) }))}
      subject={subject}
      onPickElder={setPicked}
      canCall={!!dialNumber}
      callLabel={isElder ? t('rc.callCaregiver') : tf('rc.callElder', { name: subjectName })}
      onCall={() => dial(dialNumber)}
      canCallFamily={!!caregiverPhone}
      chipLabel={(c) => chipLabel(c, isElder, subjectName)}
      onChip={onChip}
      onSend={chat.send}
      onDose={chat.answerDose}
      onMood={chat.pickMood}
      moodNotice={isElder && moodNotice.data !== false}
      onDialHelp={(phone) => dial(phone)}
    />
  );
}

function chipLabel(c: Chip, isElder: boolean, name: string): string {
  if (c === 'meds') return !isElder && name ? tf('rc.chip.medsOf', { name }) : t('rc.chip.meds');
  if (c === 'readings') return !isElder && name ? tf('rc.chip.readingsOf', { name }) : t('rc.chip.readings');
  return t(`rc.chip.${c}`);
}

export type RafiqChatProps = {
  isElder: boolean;
  lang: 'ar' | 'en';
  msgs: StoredMsg[];
  loading: boolean;
  noElder: boolean;
  elders: { id: string; name: string }[];
  subject: string | undefined;
  onPickElder: (id: string) => void;
  canCall: boolean;
  callLabel: string;
  onCall: () => void;
  canCallFamily: boolean;
  chipLabel: (c: Chip) => string;
  onChip: (c: Chip) => void;
  onSend: (text: string) => void;
  onDose: (msgId: string, status: 'done' | 'snoozed') => void;
  onMood: (msgId: string, mood: 1 | 2 | 3) => void;
  /** Elder only: say under the mood question that "Not good" tells the family. */
  moodNotice?: boolean;
  onDialHelp: (phone: string) => void;
};

/** The screen itself, data in, events out — also rendered by the emulator-only design preview. */
export function RafiqChatView(p: RafiqChatProps) {
  const [mode, setMode] = useState<'chat' | 'talk'>('chat');
  const [ttsMissing, setTtsMissing] = useState(false);
  const speaking = useSpeaking();
  useEffect(() => () => stopSpeaking(), []);

  const readAloud = async (text: string) => {
    const ok = await speak(text, p.lang);
    setTtsMissing(!ok);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={safeBack} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.back')} style={styles.back}>
          <ChevronLeftIcon />
        </Pressable>
        <Image source={require('@/assets/brand/mark-blue.png')} style={styles.mark} resizeMode="contain" accessibilityIgnoresInvertColors />
        <Text style={styles.title}>{t('rc.title')}</Text>
        <View style={styles.flex} />
        {p.isElder ? <View><SosButton variant="pill" /></View> : null}
        {p.canCall ? (
          <Pressable onPress={p.onCall} hitSlop={10} style={styles.headerIcon} accessibilityRole="button" accessibilityLabel={p.callLabel}>
            <PhoneIcon size={20} color={colors.textPrimary} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.modes}>
        {(['chat', 'talk'] as const).map((m) => {
          const on = mode === m;
          const c = on ? colors.textInverse : colors.primary;
          return (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.mode, on && styles.modeOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Text style={[styles.modeLabel, { color: c }]}>{t(`rc.${m}`)}{on ? ' ✓' : ''}</Text>
              {m === 'chat' ? <KeyboardIcon color={c} /> : <SpeakerIcon color={c} />}
            </Pressable>
          );
        })}
      </View>

      {p.elders.length > 1 ? (
        <View style={styles.elders}>
          {p.elders.map((e) => (
            <Pressable key={e.id} onPress={() => p.onPickElder(e.id)} style={[styles.elderChip, p.subject === e.id && styles.elderChipOn]} accessibilityRole="button">
              <Text style={[styles.chipText, p.subject === e.id && { color: colors.textInverse }]}>{e.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {p.noElder ? (
        <Text style={styles.empty}>{t('rc.noElder')}</Text>
      ) : mode === 'chat' ? (
        <ChatList {...p} onRead={readAloud} ttsMissing={ttsMissing} />
      ) : (
        <TalkPanel {...p} speaking={speaking} ttsMissing={ttsMissing} onRead={readAloud} />
      )}

      {mode === 'chat' && !p.noElder ? <Composer onSend={p.onSend} /> : null}
    </SafeAreaView>
  );
}

function ChatList(p: RafiqChatProps & { onRead: (text: string) => void; ttsMissing: boolean }) {
  const list = useRef<FlatList<StoredMsg>>(null);
  const lastRafiq = [...p.msgs].reverse().find((m) => m.from === 'rafiq')?.id;
  const e = p.isElder;
  return (
    <FlatList
      ref={list}
      data={p.msgs}
      keyExtractor={(m) => m.id}
      contentContainerStyle={styles.list}
      onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
      ListHeaderComponent={
        <View style={styles.listHead}>
          <Text style={styles.private}>{t(e ? 'rc.private' : 'rc.privateCarer')}</Text>
          {p.ttsMissing ? <Text style={styles.private}>{t('rc.noTts')}</Text> : null}
        </View>
      }
      ListEmptyComponent={p.loading ? <Text style={styles.empty}>{t('common.loading')}</Text> : null}
      renderItem={({ item: m }) => m.from === 'me' ? (
        <View style={styles.meRow}>
          <View style={[styles.bubble, styles.meBubble]}><Text style={[styles.bubbleText, styles.meText]}>{m.text}</Text></View>
        </View>
      ) : (
        <View style={styles.rafiqRow}>
          <View style={styles.rafiqLine}>
            <View style={[styles.bubble, styles.rafiqBubble]}><Text style={styles.bubbleText}>{m.text}</Text></View>
            {speechAvailable ? (
              <Pressable onPress={() => p.onRead(m.text)} hitSlop={8} style={styles.read} accessibilityRole="button" accessibilityLabel={t('rc.readAloud')}>
                <SpeakerIcon size={20} />
              </Pressable>
            ) : null}
          </View>

          {m.help?.length ? m.help.map((h) => (
            <Pressable key={h.phone} onPress={() => p.onDialHelp(h.phone)} style={[styles.action, styles.helpBtn, e && styles.elderBtn]} accessibilityRole="button">
              <PhoneIcon size={18} color={colors.textInverse} />
              <Text style={[styles.actionText, { color: colors.textInverse }]}>{tf('rc.callHelp', { label: h.label[p.lang], phone: h.phone })}</Text>
            </Pressable>
          )) : null}

          {m.dose && !m.dose.answered ? (
            <View style={styles.actions}>
              <Pressable onPress={() => p.onDose(m.id, 'done')} style={[styles.action, styles.actionPrimary, e && styles.elderBtn]} accessibilityRole="button">
                <Text style={[styles.actionText, { color: colors.textInverse }]}>{t('eh.tookIt')}</Text>
              </Pressable>
              <Pressable onPress={() => p.onDose(m.id, 'snoozed')} style={[styles.action, e && styles.elderBtn]} accessibilityRole="button">
                <Text style={styles.actionText}>{t('eh.remindMe')}</Text>
              </Pressable>
            </View>
          ) : null}

          {m.mood && !m.moodPicked && e ? <MoodFaces onPick={(v) => p.onMood(m.id, v)} notice={p.moodNotice} /> : null}

          {m.id === lastRafiq && m.chips?.length ? (
            <View style={styles.chips}>
              {m.chips.filter((c) => c !== 'call' || p.canCallFamily).map((c) => (
                <Pressable key={c} onPress={() => p.onChip(c)} style={[styles.chip, e && styles.elderBtn]} accessibilityRole="button">
                  <Text style={styles.chipText}>{p.chipLabel(c)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      )}
    />
  );
}

function MoodFaces({ onPick, notice }: { onPick: (v: 1 | 2 | 3) => void; notice?: boolean }) {
  const faces: { v: 1 | 2 | 3; face: string; key: string }[] = [
    { v: 3, face: '😊', key: 'rc.mood.good' },
    { v: 2, face: '😐', key: 'rc.mood.okay' },
    { v: 1, face: '😟', key: 'rc.mood.low' },
  ];
  return (
    <View style={styles.moodBox}>
      <View style={styles.faces}>
        {faces.map((f) => (
          <Pressable key={f.v} onPress={() => onPick(f.v)} style={styles.face} accessibilityRole="button" accessibilityLabel={t(f.key)}>
            <Text style={styles.faceEmoji}>{f.face}</Text>
            <Text style={styles.faceLabel}>{t(f.key)}</Text>
          </Pressable>
        ))}
      </View>
      {notice ? <Text style={styles.moodNote}>{t('rc.mood.notice')}</Text> : null}
    </View>
  );
}

function TalkPanel(p: RafiqChatProps & { speaking: boolean; ttsMissing: boolean; onRead: (text: string) => void }) {
  const last = [...p.msgs].reverse().find((m) => m.from === 'rafiq');
  const moodMsg = p.isElder ? [...p.msgs].reverse().find((m) => m.mood && !m.moodPicked) : undefined;
  return (
    <View style={styles.talk}>
      <Text style={styles.listening}>{p.speaking ? `“${t('rc.readAloud')}…”` : t('rc.talkHint')}</Text>
      <Pressable onPress={() => last && p.onRead(last.text)} disabled={!last} accessibilityRole="button" accessibilityLabel={t('rc.readAloud')} style={styles.orbWrap}>
        <Image source={require('@/assets/brand/mark-blue.png')} style={styles.orb} resizeMode="contain" />
      </Pressable>
      <Text style={styles.talkText} numberOfLines={4}>{last?.text ?? t('rc.noMessage')}</Text>
      <Wave on={p.speaking} />
      {p.speaking ? (
        <Pressable onPress={stopSpeaking} style={styles.stop} accessibilityRole="button">
          <PhoneOffIcon />
          <Text style={styles.stopText}>{t('rc.stop')}</Text>
        </Pressable>
      ) : (
        <Pressable onPress={() => last && p.onRead(last.text)} disabled={!last} style={[styles.readBig, p.isElder && styles.elderBtn]} accessibilityRole="button">
          <SpeakerIcon color={colors.textInverse} />
          <Text style={styles.stopText}>{t('rc.readAloud')}</Text>
        </Pressable>
      )}
      {p.ttsMissing ? <Text style={styles.private}>{t('rc.noTts')}</Text> : null}
      {moodMsg ? (
        <View style={styles.talkMood}>
          <Text style={styles.talkMoodTitle}>{t('rc.howFeel')}</Text>
          <MoodFaces onPick={(v) => p.onMood(moodMsg.id, v)} notice={p.moodNotice} />
        </View>
      ) : null}
    </View>
  );
}

/** The frame's nine wave bars; they pulse while Rafiq is reading. */
function Wave({ on }: { on: boolean }) {
  const H = [20, 48, 64, 32, 72, 80, 56, 38, 24];
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setTick((n) => n + 1), 180);
    return () => clearInterval(id);
  }, [on]);
  return (
    <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {H.map((h, i) => {
        const k = on ? 0.55 + 0.45 * Math.abs(Math.sin((tick + i * 1.7) * 0.9)) : 0.35;
        return <View key={i} style={[styles.bar, { height: Math.max(8, Math.round(h * k)) }]} />;
      })}
    </View>
  );
}

function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const send = () => {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
  };
  return (
    <View style={styles.footer}>
      <View style={styles.reply}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('rc.placeholder')}
          placeholderTextColor="#828282"
          style={styles.input}
          multiline
          maxLength={500}
          onSubmitEditing={send}
          blurOnSubmit
          returnKeyType="send"
          accessibilityLabel={t('rc.placeholder')}
        />
      </View>
      <Pressable onPress={send} disabled={!draft.trim()} style={[styles.send, !draft.trim() && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel={t('rc.send')}>
        <SendIcon />
      </Pressable>
    </View>
  );
}

// Figma 05 / 04: Inter in the frame; the same sizes in Noto Sans Arabic in Arabic.
const T = {
  title: { size: 16, line: 22, weight: 600 },
  mode: { size: 17, line: 27, weight: 600 },
  bubble: { size: 14, line: 20, weight: 500 },
  input: { size: 14, line: 20, weight: 400 },
  small: { size: 12, line: 16, weight: 400 },
  action: { size: 14, line: 18, weight: 700 },
  listening: { size: 18, line: 22, weight: 500 },
  stop: { size: 16, line: 19, weight: 700 },
  face: { size: 12, line: 15, weight: 600 },
} satisfies Record<string, TextToken>;

const RAFIQ_BUBBLE = '#e9e9eb';
const HEADER_LINE = '#e6e6e6';
const INPUT_LINE = '#e0e0e0';
const LISTENING = '#a2cdff';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', height: 69, paddingHorizontal: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: HEADER_LINE },
  back: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 52, height: 46 },
  title: { ...textStyle(T.title), color: colors.textPrimary },
  headerIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  modes: { flexDirection: 'row', gap: 8, paddingHorizontal: 6, marginTop: 10 },
  mode: { flex: 1, height: 60, borderRadius: 16, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 18 },
  modeOn: { backgroundColor: colors.primary },
  modeLabel: { ...textStyle(T.mode) },

  elders: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingTop: 10 },
  elderChip: { minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary, justifyContent: 'center' },
  elderChipOn: { backgroundColor: colors.primary },

  list: { paddingHorizontal: 14, paddingBottom: 16, gap: 10 },
  listHead: { paddingVertical: 12, gap: 4 },
  private: { ...textStyle(T.small), color: colors.textSecondary, textAlign: 'center' },
  empty: { ...textStyle(T.bubble), color: colors.textSecondary, textAlign: 'center', padding: 24 },

  meRow: { alignItems: 'flex-end' },
  rafiqRow: { alignItems: 'flex-start', gap: 8 },
  rafiqLine: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '88%' },
  bubble: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 18, maxWidth: '80%' },
  rafiqBubble: { backgroundColor: RAFIQ_BUBBLE, flexShrink: 1, maxWidth: '100%' },
  meBubble: { backgroundColor: colors.primary },
  bubbleText: { ...textStyle(T.bubble), color: colors.primary },
  meText: { color: colors.textInverse },
  read: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  action: { minHeight: 44, paddingHorizontal: 18, borderRadius: radius.button, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionPrimary: { backgroundColor: colors.primary },
  actionText: { ...textStyle(T.action), color: colors.primary },
  helpBtn: { backgroundColor: colors.alertCritical, borderColor: colors.alertCritical, alignSelf: 'stretch' },
  elderBtn: { minHeight: 64 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: radius.button, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.lavender, justifyContent: 'center' },
  chipText: { ...textStyle(T.action), color: colors.primary },

  moodBox: { gap: 8 },
  faces: { flexDirection: 'row', gap: 10 },
  moodNote: { ...textStyle(T.small), color: colors.textSecondary, textAlign: 'left', maxWidth: 272 },
  face: { width: 84, minHeight: 84, borderRadius: radius.stat, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center', gap: 2 },
  faceEmoji: { fontSize: 36, lineHeight: 44 },
  faceLabel: { ...textStyle(T.face), color: colors.primary },

  talk: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 36, gap: 18 },
  listening: { ...textStyle(T.listening), color: LISTENING, textAlign: 'center' },
  orbWrap: { width: 214, height: 190, alignItems: 'center', justifyContent: 'center' },
  orb: { width: 190, height: 170 },
  talkText: { ...textStyle(T.bubble), color: colors.primary, textAlign: 'center' },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 80 },
  bar: { width: 6, borderRadius: 3, backgroundColor: colors.accent },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.alertCritical, borderRadius: radius.pill, paddingVertical: 12, paddingHorizontal: 24, minHeight: 44 },
  readBig: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 12, paddingHorizontal: 24, minHeight: 44 },
  stopText: { ...textStyle(T.stop), color: colors.textInverse },
  talkMood: { alignItems: 'center', gap: 10, marginTop: 6 },
  talkMoodTitle: { ...textStyle(T.action), color: colors.textPrimary },

  footer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  reply: { flex: 1, minHeight: 40, borderRadius: 8, borderWidth: 1, borderColor: INPUT_LINE, backgroundColor: colors.surface, paddingHorizontal: 16, justifyContent: 'center' },
  input: { ...textStyle(T.input), color: colors.textPrimary, paddingVertical: 8, maxHeight: 120 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
