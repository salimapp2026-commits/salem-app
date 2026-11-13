// Emulator test builds only (-PsalemEmulatorOnly=true): renders a rebuilt screen
// with the Figma frame's own sample content, so it can be compared with the
// design without signing in. In every other build this renders nothing, and the
// salem://dev/preview link is ignored (App.tsx). Never shown to a family.
import { NativeModules, View } from 'react-native';
import { useLocalSearchParams } from '@/navigation/router';
import { ElderHomeView } from '@/app/(elder)/index';
import { CaregiverHomeView } from '@/app/(family)/index';
import { RafiqChatView } from '@/app/rafiq-chat';
import { elderDoses } from '@/lib/elderHome';
import { HELP_NUMBERS } from '@/lib/rafiqChat/lines';

export const PREVIEW_ENABLED = NativeModules.SalemApp?.testTools === true;

const at = (hhmm: string) => {
  const d = new Date();
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export default function DesignPreview() {
  const { screen } = useLocalSearchParams<{ screen?: string }>();
  if (!PREVIEW_ENABLED) return <View />;
  if (screen === 'elder-home' || !screen) {
    // The frame's content: two doses (one taken), 78 bpm, 120/80, 2,400 steps, a caregiver and a doctor.
    const plan = elderDoses([
      { id: 1, scheduled_at: at('08:00'), status: 'done', title: 'medicine (1)' },
      { id: 2, scheduled_at: at('00:30'), status: 'pending', title: 'medicine (2)' },
    ], Date.now());
    return (
      <ElderHomeView
        plan={plan}
        dosesLoaded
        stats={{
          heartRate: { bpm: 78, bars: [72, 74, 70, 77, 75, 73, 80, 76, 78], at: new Date().toISOString() },
          pressure: { systolic: 120, diastolic: 80, at: new Date().toISOString() },
          steps: 2400,
          band: { kind: 'connected' },
        }}
        caregiver={{ member_role: 'primary_caretaker', display_name: 'Care giver1', phone_e164: '+201000000000' }}
        doctor={{ member_role: 'doctor', display_name: 'doctor name', phone_e164: '+201000000001' }}
        busy={false}
        onTook={() => {}}
        onRemind={() => {}}
        onTab={() => {}}
      />
    );
  }
  if (screen === 'caregiver-home') {
    // The frame's content, with Rafiq's status in place of the conversation summary.
    return (
      <CaregiverHomeView
        elderName="Papa"
        hasElder
        stats={{
          heartRate: { bpm: 78, bars: [72, 74, 70, 77, 75, 73, 80, 76, 78], at: new Date().toISOString() },
          pressure: { systolic: 120, diastolic: 80, at: new Date().toISOString() },
          steps: 2400,
          band: { kind: 'connected' },
        }}
        report={{ line: 'Everything is as usual compared with Papa’s normal', tone: 'calm', preview: null }}
        location={{ captured_at: new Date().toISOString(), zone_name: 'Home', inside_zone: true }}
        adherence={{ done: 3, total: 4, pct: 75 }}
        unread={1}
        onBell={() => {}}
        onElder={() => {}}
        onReport={() => {}}
        onLocation={() => {}}
        onAddMember={() => {}}
        onTab={() => {}}
      />
    );
  }
  if (screen === 'rafiq-chat' || screen === 'rafiq-chat-carer') {
    // A morning: Rafiq's check-in, a medicine reminder, a question and its answer, a crisis reply.
    const elder = screen === 'rafiq-chat';
    const t0 = Date.now() - 3_600_000;
    const msgs = elder ? [
      { id: 'a', from: 'rafiq' as const, at: t0, text: 'Good morning, Mona! Did you sleep well?', mood: true, moodPicked: 3 as const },
      { id: 'b', from: 'rafiq' as const, at: t0 + 1, text: 'That makes me so happy to hear!' },
      { id: 'c', from: 'rafiq' as const, at: t0 + 2, text: 'Time for your Glucophage 500 (12:00). Shall we take it now?', dose: { eventId: 2, med: 'Glucophage 500' } },
      { id: 'd', from: 'me' as const, at: t0 + 3, text: 'How are my readings?' },
      { id: 'e', from: 'rafiq' as const, at: t0 + 4, text: 'Your latest readings: heart rate 74 bpm (10 min ago) · 1,240 steps today. I’m still getting to know your normal — day 3 of 7. After that I can compare each day with your usual. Rafiq is not a medical device.', chips: ['meds' as const, 'readings' as const, 'mood' as const] },
    ] : [
      { id: 'a', from: 'rafiq' as const, at: t0, text: 'Hello Omar. Ask me about Mona’s medicine or readings.' },
      { id: 'b', from: 'me' as const, at: t0 + 1, text: 'Mona’s medicine' },
      { id: 'c', from: 'rafiq' as const, at: t0 + 2, text: 'Mona has taken 1 of 3 doses so far today. Glucophage 500 was due at 12:00 and isn’t marked as taken yet. Next: Aspirin 81 at 21:00.', chips: ['meds' as const, 'readings' as const, 'insights' as const] },
      { id: 'd', from: 'me' as const, at: t0 + 3, text: 'I can’t do this anymore, I want to die' },
      { id: 'e', from: 'rafiq' as const, at: t0 + 4, text: 'You matter, and you don’t have to carry this alone. Please reach out now — call one of these numbers:', help: HELP_NUMBERS },
    ];
    return (
      <RafiqChatView
        isElder={elder}
        lang="en"
        msgs={msgs}
        loading={false}
        noElder={false}
        elders={[]}
        subject="x"
        onPickElder={() => {}}
        canCall
        callLabel="Call"
        onCall={() => {}}
        canCallFamily
        chipLabel={(c) => ({ meds: elder ? 'My medicine' : 'Mona’s medicine', readings: elder ? 'My readings' : 'Mona’s readings', mood: 'How I feel', help: 'What can you do?', insights: 'Rafiq details', call: 'Call my family' })[c]}
        onChip={() => {}}
        onSend={() => {}}
        onDose={() => {}}
        onMood={() => {}}
        onDialHelp={() => {}}
      />
    );
  }
  return <View />;
}
