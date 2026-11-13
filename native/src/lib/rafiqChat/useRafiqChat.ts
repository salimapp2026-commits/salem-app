// The chat's state on the phone. Conversations are stored ONLY on this phone
// (AsyncStorage, per signed-in user) and never sent anywhere — caregivers never see
// them (founder, 4g). What reaches the server: the mood from the three faces, a
// "crisis happened" alert with no words, an "elder talked to Rafiq" marker, and the
// answers to medicine doses (reminder_event_respond, as on the elder home).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { type ChatConfig, DEFAULT_CONFIG, type HelpNumber, type Lang, LINES, type Lines } from './lines';
import {
  type ChatContext, type Chip, classify, dueProactive, type Intent, line, mergeConfig, mergeLines, reply, type ServerLine,
} from './engine';

export type StoredMsg = {
  id: string;
  from: 'rafiq' | 'me';
  text: string;
  at: number;
  chips?: Chip[];
  mood?: boolean;
  moodPicked?: 1 | 2 | 3;
  help?: HelpNumber[];
  dose?: { eventId: number; med: string; answered?: 'done' | 'snoozed' };
};
type Store = { msgs: StoredMsg[]; day: string; sent: string[] };

const KEEP = 200;
const SETUP_KEY = 'rafiq_chat_setup_v1';
const storeKey = (userId: string) => `rafiq_chat_v1:${userId}`;

export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Settings and lines: the server's, else the last ones this phone saw, else built in.
 *  Never fails — Rafiq always has something to say. */
export function useChatSetup() {
  return useQuery<{ cfg: ChatConfig; lines: Lines }>({
    queryKey: ['rafiq_chat_setup'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const [c, l] = await Promise.all([
        supabase.from('app_config').select('value').eq('key', 'rafiq_chat').maybeSingle(),
        supabase.from('rafiq_lines').select('category, lang, text, active').eq('active', true).limit(2000),
      ]);
      if (!c.error && !l.error) {
        const raw = { cfg: c.data?.value ?? null, lines: (l.data ?? []) as ServerLine[] };
        await AsyncStorage.setItem(SETUP_KEY, JSON.stringify(raw)).catch(() => {});
        return { cfg: mergeConfig(raw.cfg), lines: mergeLines(raw.lines) };
      }
      const cached = await AsyncStorage.getItem(SETUP_KEY).catch(() => null);
      if (cached) {
        try {
          const raw = JSON.parse(cached) as { cfg: unknown; lines: ServerLine[] };
          return { cfg: mergeConfig(raw.cfg), lines: mergeLines(raw.lines) };
        } catch { /* fall through */ }
      }
      return { cfg: DEFAULT_CONFIG, lines: LINES };
    },
  });
}

export type ChatActions = {
  msgs: StoredMsg[];
  loaded: boolean;
  send: (text: string) => void;
  ask: (intent: Intent, label: string) => void;
  askMood: (label: string) => void;
  answerDose: (msgId: string, status: 'done' | 'snoozed') => void;
  pickMood: (msgId: string, mood: 1 | 2 | 3) => void;
};

/**
 * @param userId   the signed-in user (the chat belongs to them)
 * @param subject  the elder the data is about (the user, for an elder)
 * @param ctx      Rafiq's facts right now; null while loading
 */
export function useRafiqChat(userId: string | undefined, subject: string | undefined, ctx: ChatContext | null): ChatActions {
  const qc = useQueryClient();
  const setup = useChatSetup();
  const cfg = setup.data?.cfg ?? DEFAULT_CONFIG;
  const lines = setup.data?.lines ?? LINES;
  const [store, setStore] = useState<Store | null>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const lastTouch = useRef(0);

  // Load this user's chat from the phone.
  useEffect(() => {
    if (!userId) return;
    let live = true;
    AsyncStorage.getItem(storeKey(userId)).catch(() => null).then((raw) => {
      if (!live) return;
      let s: Store = { msgs: [], day: localDay(), sent: [] };
      try {
        if (raw) s = JSON.parse(raw) as Store;
      } catch { /* a broken copy starts fresh */ }
      setStore(s);
    });
    return () => { live = false; };
  }, [userId]);

  // Save on every change.
  useEffect(() => {
    if (userId && store) void AsyncStorage.setItem(storeKey(userId), JSON.stringify(store)).catch(() => {});
  }, [userId, store]);

  const append = useCallback((...msgs: Omit<StoredMsg, 'id' | 'at'>[]) => {
    setStore((s) => s && { ...s, msgs: [...s.msgs, ...msgs.map((m, i) => ({ ...m, id: newId(), at: Date.now() + i }))].slice(-KEEP) });
  }, []);
  const patch = useCallback((id: string, p: Partial<StoredMsg>) => {
    setStore((s) => s && { ...s, msgs: s.msgs.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  }, []);

  const lang: Lang = ctx?.lang ?? 'en';
  const L = useCallback((cat: string, vars: Record<string, string | number> = {}) =>
    line(lines, cat, lang, { me: ctxRef.current?.me ?? '', name: ctxRef.current?.name ?? '', ...vars }), [lines, lang]);

  const touch = useCallback(() => {
    if (ctxRef.current?.role !== 'elder' || Date.now() - lastTouch.current < 10 * 60_000) return;
    lastTouch.current = Date.now();
    void supabase.rpc('rafiq_touch');
  }, []);

  const crisis = useCallback(() => {
    // Caregivers learn that it happened, never the words. If the crisis function is
    // not on the server yet, an SOS still reaches the family.
    void supabase.rpc('raise_crisis_alert').then(({ error }) => {
      if (error) void supabase.rpc('raise_sos', { p_note: 'rafiq_chat' });
    });
  }, []);

  const answer = useCallback((intent: Intent) => {
    const c = ctxRef.current;
    if (!c) return;
    const r = reply(intent, c, lines, cfg);
    append({ from: 'rafiq', text: r.text, chips: r.chips, mood: r.mood, help: r.help });
    if (r.crisis) crisis();
  }, [append, cfg, crisis, lines]);

  const send = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    append({ from: 'me', text: t });
    touch();
    answer(classify(t, cfg.crisis_words));
  }, [answer, append, cfg.crisis_words, touch]);

  const ask = useCallback((intent: Intent, label: string) => {
    append({ from: 'me', text: label });
    touch();
    answer(intent);
  }, [answer, append, touch]);

  const askMood = useCallback((label: string) => {
    append({ from: 'me', text: label }, { from: 'rafiq', text: L('mood_ask'), mood: true });
    touch();
  }, [L, append, touch]);

  const answerDose = useCallback((msgId: string, status: 'done' | 'snoozed') => {
    const m = store?.msgs.find((x) => x.id === msgId);
    if (!m?.dose || m.dose.answered) return;
    const dose = m.dose;
    touch();
    const call = status === 'snoozed'
      ? supabase.rpc('reminder_snooze', { p_event_id: dose.eventId, p_kind: 'later' })
      : supabase.rpc('reminder_event_respond', { p_event_id: dose.eventId, p_status: status, p_notes: null });
    void call
      .then(({ error }) => {
        if (error) {
          append({ from: 'rafiq', text: L('reminder_failed') });
          return;
        }
        patch(msgId, { dose: { ...dose, answered: status } });
        append({ from: 'rafiq', text: L(status === 'done' ? 'reminder_taken' : 'reminder_snoozed', { med: dose.med }) });
        void qc.invalidateQueries({ queryKey: ['elder-home-doses', subject] });
      });
  }, [L, append, patch, qc, store?.msgs, subject, touch]);

  const pickMood = useCallback((msgId: string, mood: 1 | 2 | 3) => {
    patch(msgId, { moodPicked: mood });
    touch();
    const text = L(mood === 3 ? 'mood_good' : mood === 2 ? 'mood_okay' : 'mood_low');
    void supabase.rpc('record_mood', { p_mood: mood, p_day: localDay() }).then(({ error }) => {
      append({
        from: 'rafiq',
        text: error ? `${text} ${L('reminder_failed')}` : text,
        chips: mood === 1 ? ['call', 'meds', 'readings'] : ['meds', 'readings'],
      });
    });
  }, [L, append, patch, touch]);

  // A first hello, and what Rafiq says first when the elder opens the chat.
  const doses = ctx?.doses;
  const role = ctx?.role;
  useEffect(() => {
    if (!store || !ctx || !setup.isFetched) return;
    const today = localDay();
    const sent = store.day === today ? store.sent : [];
    const out: Omit<StoredMsg, 'id' | 'at'>[] = [];
    const keys: string[] = [];
    if (!store.msgs.length) {
      const r = reply('greeting', ctx, lines, cfg);
      out.push({ from: 'rafiq', text: r.text, chips: r.chips });
    }
    if (role === 'elder' && doses) {
      const now = new Date();
      const lastMine = [...store.msgs].reverse().find((m) => m.from === 'me')?.at ?? null;
      for (const p of dueProactive(doses, now.getHours() * 60 + now.getMinutes(), sent, lastMine, now.getTime(), cfg)) {
        keys.push(p.key);
        if (p.kind === 'dose') {
          out.push({
            from: 'rafiq',
            text: L('reminder_dose', { med: p.dose.title, time: ctx.fmtTime(p.dose.at) }),
            dose: { eventId: p.dose.id, med: p.dose.title },
          });
        } else {
          out.push({ from: 'rafiq', text: L(p.part === 'morning' ? 'checkin_morning' : 'checkin_evening'), mood: true });
        }
      }
    }
    if (!out.length && store.day === today) return;
    setStore((s) => s && {
      msgs: [...s.msgs, ...out.map((m, i) => ({ ...m, id: newId(), at: Date.now() + i }))].slice(-KEEP),
      day: today,
      sent: [...sent, ...keys],
    });
    // Runs when the data arrives or changes; the sent keys stop repeats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.day, store?.sent.length, store?.msgs.length === 0, doses, role, setup.isFetched]);

  return useMemo(() => ({
    msgs: store?.msgs ?? [], loaded: !!store, send, ask, askMood, answerDose, pickMood,
  }), [answerDose, ask, askMood, pickMood, send, store]);
}
