// Everything Rafiq says in the chat, in one reviewable file — the built-in copy.
//
// The live copy is on the server (table rafiq_lines, config app_config 'rafiq_chat',
// migration step32a): when the server has active lines for a category and language,
// the app uses those; otherwise these. So a line can be fixed during the beta from
// Supabase, without a new APK. Pure — no imports — so it is tested without a phone.
//
// Voice: a warm, respectful companion of the elder's generation — gentle humour,
// never mocking age or illness, never a diagnosis. Placeholders in {braces} are
// filled from real data only (lib/rafiqChat/engine.ts); a line whose data is
// missing is never used.
//
// Categories starting with "c_" are for caregivers and doctors, who ask about the
// elder ({name}); the rest speak to the elder.

export type Lang = 'ar' | 'en';
export type Lines = Record<string, Record<Lang, string[]>>;

export const LINES: Lines = {
  // ── Small talk ──────────────────────────────────────────────────────────────
  greeting: {
    en: [
      'Hello {me}! How lovely to hear from you.',
      'Good to see you, {me}. I’m right here.',
      'Hello, {me}! Your company always brightens my day.',
      'Welcome, {me}. What shall we talk about?',
      'Hello there, {me}! I was hoping you’d stop by.',
    ],
    ar: [
      'أهلاً يا {me}! نوّرت.',
      'أهلاً وسهلاً يا {me}، أنا معاك.',
      'يا أهلاً يا {me}! كلامك بيفرّح قلبي.',
      'أهلاً يا {me}، نتكلم في إيه النهارده؟',
      'منوّر يا {me}! كنت مستنيك.',
    ],
  },
  how_are_you: {
    en: [
      'I’m well, thank you for asking! And how are you feeling today?',
      'All good on my side. More importantly — how are you today?',
      'I’m doing fine, {me}. Tell me, how is your day going?',
      'Very well, thank you. How do you feel today?',
    ],
    ar: [
      'الحمد لله بخير، تسلم على السؤال! وحضرتك عامل إيه النهارده؟',
      'أنا تمام. الأهم حضرتك، عامل إيه النهارده؟',
      'بخير يا {me}. قولّي، يومك ماشي إزاي؟',
      'الحمد لله. وحضرتك حاسس بإيه النهارده؟',
    ],
  },
  thanks: {
    en: ['You’re most welcome, {me}.', 'Any time — that’s what I’m here for.', 'My pleasure, {me}.'],
    ar: ['العفو يا {me}.', 'تحت أمرك في أي وقت.', 'ده واجبي يا {me}.'],
  },
  help: {
    en: [
      'I can tell you about today’s medicine, your latest readings, or simply keep you company. Tap one of the buttons below.',
    ],
    ar: [
      'أقدر أقولك على دوا النهارده، وآخر قياساتك، أو أونّسك شوية. اختار زرار من تحت.',
    ],
  },
  fallback: {
    en: [
      'I’m sorry, I didn’t quite understand that. I can help with the things below.',
      'Forgive me, I’m still learning to understand everything. Shall we try one of these?',
      'I didn’t catch that, {me}. Here is what I can help with.',
    ],
    ar: [
      'معلش، ما فهمتش قصدك. أقدر أساعدك في الحاجات اللي تحت.',
      'سامحني، لسه بتعلّم أفهم كل حاجة. نجرّب واحدة من دول؟',
      'ما وصلنيش قصدك يا {me}. ده اللي أقدر أساعد فيه.',
    ],
  },

  // ── Medicine (elder) ────────────────────────────────────────────────────────
  meds_none: {
    en: ['There’s no medicine scheduled for you today.'],
    ar: ['مفيش دوا متسجّل لحضرتك النهارده.'],
  },
  meds_all_taken: {
    en: ['You’ve taken all {total} of today’s doses. Well done!', 'All {total} doses taken today — excellent!'],
    ar: ['خدت كل جرعات النهارده ({total}). برافو عليك!', 'كل الجرعات اتاخدت النهارده ({total}) — ممتاز!'],
  },
  meds_status: {
    en: ['So far today you’ve taken {done} of {total} doses.'],
    ar: ['لحد دلوقتي خدت {done} من {total} جرعات النهارده.'],
  },
  meds_due: {
    en: ['{med} was due at {time} — have you taken it?'],
    ar: ['{med} كان ميعاده الساعة {time} — خدته؟'],
  },
  meds_next: {
    en: ['Your next one is {med} at {time}.'],
    ar: ['اللي جاي {med} الساعة {time}.'],
  },

  // ── Readings (elder) ────────────────────────────────────────────────────────
  readings_none: {
    en: ['I don’t have any readings from you yet. Once your band sends some, I’ll tell you about them.'],
    ar: ['لسه ما وصلنيش قياسات منك. أول ما السوار يبعت، هقولك عليها.'],
  },
  readings_values: {
    en: ['Your latest readings: {values}.'],
    ar: ['آخر قياساتك: {values}.'],
  },
  readings_learning: {
    en: ['I’m still getting to know your normal — day {day} of {of}. After that I can compare each day with your usual.'],
    ar: ['لسه بتعرّف على الطبيعي بتاعك — اليوم {day} من {of}. بعدها هقدر أقارن كل يوم باللي متعود عليه.'],
  },
  readings_usual: {
    en: ['Compared with your usual, everything looks as normal.'],
    ar: ['مقارنةً باللي متعود عليه، كله زي العادة.'],
  },
  readings_unusual: {
    en: ['Something looks unusual compared to your normal. If you’re worried, please contact your doctor.'],
    ar: ['فيه حاجة مختلفة عن الطبيعي بتاعك. لو قلقان، كلّم دكتورك من فضلك.'],
  },
  readings_stale: {
    en: ['I haven’t had new readings for a few days. Is the band on and charged?'],
    ar: ['ما وصلنيش قياسات جديدة من كام يوم. السوار ملبوس ومشحون؟'],
  },
  not_device: {
    en: ['Rafiq is not a medical device.'],
    ar: ['رفيق ليس جهازاً طبياً.'],
  },

  // ── Mood (elder) ────────────────────────────────────────────────────────────
  mood_ask: {
    en: ['How are you feeling today?', 'How is your mood today, {me}?'],
    ar: ['حاسس بإيه النهارده؟', 'مزاجك عامل إيه النهارده يا {me}؟'],
  },
  mood_good: {
    en: ['That makes me so happy to hear!', 'Wonderful — may every day be like this.', 'Lovely! Keep that smile.'],
    ar: ['ده يفرّحني جداً!', 'الحمد لله — يا رب كل أيامك كده.', 'جميل! خلّي الضحكة دي على طول.'],
  },
  mood_okay: {
    en: ['Thank you for telling me. I’m here if you want to talk.', 'An ordinary day is a good day too.'],
    ar: ['شكراً إنك قلتلي. أنا هنا لو حبيت تتكلم.', 'اليوم العادي برضه يوم حلو.'],
  },
  mood_low: {
    en: [
      'I’m sorry you’re not feeling well. Would you like to call someone from your family?',
      'Thank you for telling me. You’re not alone — your family is a call away.',
    ],
    ar: [
      'سلامتك، زعلت إنك مش مرتاح. تحب تكلّم حد من العيلة؟',
      'شكراً إنك قلتلي. إنت مش لوحدك — عيلتك على بُعد مكالمة.',
    ],
  },
  mood_saved: {
    en: ['I’ve noted how you feel today.'],
    ar: ['سجّلت إحساسك النهارده.'],
  },

  // ── Rafiq starts the conversation (elder) — 15 each for review ──────────────
  checkin_morning: {
    en: [
      'Good morning, {me}! Did you sleep well?',
      'Good morning! A new day — how are you feeling?',
      'Morning, {me}. Have you had your breakfast yet?',
      'Good morning! The tea is ready somewhere, I’m sure. How are you?',
      'Rise and shine, {me}! How did you sleep?',
      'Good morning! I hope today is kind to you.',
      'Morning, {me}. What’s the plan for today?',
      'Good morning! Remember a glass of water to start the day.',
      'A very good morning to you, {me}! How’s the mood?',
      'Good morning! Did the birds wake you up before I did?',
      'Morning, {me}! I’ve been waiting to say hello.',
      'Good morning! Shall we start the day with a smile?',
      'Good morning, {me}. How are you feeling this morning?',
      'Morning! I hope your coffee is as strong as your spirit.',
      'Good morning, {me}! Tell me how you are.',
    ],
    ar: [
      'صباح الخير يا {me}! نمت كويس؟',
      'صباح الفل! يوم جديد — حاسس بإيه؟',
      'صباح النور يا {me}. فطرت ولا لسه؟',
      'صباح الخير! أكيد الشاي جاهز في حتة. عامل إيه؟',
      'صباح الورد يا {me}! نومك كان عامل إيه؟',
      'صباح الخير! ربنا يجعله يوم حلو عليك.',
      'صباح النور يا {me}. ناوي على إيه النهارده؟',
      'صباح الخير! ابدأ يومك بكوباية مية.',
      'صباح الياسمين يا {me}! المزاج عامل إيه؟',
      'صباح الخير! العصافير صحّتك قبلي ولا إيه؟',
      'صباح الفل يا {me}! كنت مستني أصبّح عليك.',
      'صباح الخير! نبدأ اليوم بابتسامة؟',
      'صباح النور يا {me}. حاسس بإيه الصبح ده؟',
      'صباح الخير! يا رب قهوتك تكون قوية زي عزيمتك.',
      'صباح الفل يا {me}! طمّني عليك.',
    ],
  },
  checkin_evening: {
    en: [
      'Good evening, {me}! How was your day?',
      'Evening! Did anything nice happen today?',
      'Good evening. Did you get some rest this afternoon?',
      'Good evening, {me}. Tell me about your day.',
      'The day is nearly done — how are you feeling?',
      'Good evening! Did you talk to the family today?',
      'Evening, {me}. I hope today treated you well.',
      'Good evening! Time to relax a little.',
      'Good evening, {me}! What was the best part of today?',
      'Evening! Did you have a good dinner?',
      'Good evening. How is your mood tonight?',
      'Evening, {me}! I came by to check on you.',
      'Good evening! Any news to share?',
      'Good evening, {me}. I hope you had a calm day.',
      'Evening! Did you take a little walk today?',
    ],
    ar: [
      'مساء الخير يا {me}! يومك كان عامل إيه؟',
      'مساء الفل! حصل حاجة حلوة النهارده؟',
      'مساء النور. ارتحت شوية بعد الضهر؟',
      'مساء الخير يا {me}. احكيلي عن يومك.',
      'اليوم قرّب يخلص — حاسس بإيه؟',
      'مساء الخير! كلّمت العيلة النهارده؟',
      'مساء النور يا {me}. يا رب يومك كان حلو.',
      'مساء الخير! وقت ترتاح شوية.',
      'مساء الفل يا {me}! إيه أحلى حاجة حصلت النهارده؟',
      'مساء الخير! اتعشيت كويس؟',
      'مساء النور. المزاج عامل إيه الليلة؟',
      'مساء الخير يا {me}! جيت أطمّن عليك.',
      'مساء الفل! فيه أخبار حلوة؟',
      'مساء الخير يا {me}. يا رب يومك كان هادي.',
      'مساء النور! اتمشّيت شوية النهارده؟',
    ],
  },
  reminder_dose: {
    en: [
      'Time for your {med} ({time}). Shall we take it now?',
      '{me}, it’s {time} — your {med} is waiting for you.',
      'A gentle reminder: {med} at {time}.',
      'Your {med} is due ({time}). A glass of water and done!',
      'It’s time for {med}. Your health thanks you.',
      '{med} o’clock! ({time}) Shall we?',
      'Don’t let the {med} feel forgotten — it’s {time}.',
      'Reminder from your friend Rafiq: {med}, {time}.',
      '{me}, your {med} is due now ({time}).',
      'Medicine time: {med} at {time}.',
      'Just like clockwork — {med} at {time}.',
      'Your {med} has been waiting since {time}.',
      'A small pill, a big favour to yourself: {med} ({time}).',
      'It’s {time}. Time for {med}, please.',
      'Have you got your {med} nearby? It’s due ({time}).',
    ],
    ar: [
      'ميعاد {med} (الساعة {time}). ناخده دلوقتي؟',
      'يا {me}، الساعة {time} — {med} مستنيك.',
      'تذكير صغير: {med} الساعة {time}.',
      'ميعاد {med} جه ({time}). كوباية مية وخلصنا!',
      'ميعاد {med}. صحتك هتشكرك.',
      'ساعة {med}! ({time}) يلا بينا؟',
      'ما تخليش {med} يزعل إنك نسيته — الساعة {time}.',
      'تذكير من صاحبك رفيق: {med}، الساعة {time}.',
      'يا {me}، ميعاد {med} دلوقتي ({time}).',
      'ميعاد الدوا: {med} الساعة {time}.',
      'زي الساعة بالظبط — {med} الساعة {time}.',
      '{med} مستنيك من الساعة {time}.',
      'حباية صغيرة، وجميل كبير لنفسك: {med} ({time}).',
      'الساعة {time}. ميعاد {med} من فضلك.',
      '{med} جنبك؟ ميعاده جه ({time}).',
    ],
  },
  reminder_taken: {
    en: ['Well done! I’ve marked {med} as taken.', 'Bravo — {med} taken.', 'Excellent, {med} is done.'],
    ar: ['برافو! سجّلت إن {med} اتاخد.', 'عظيم — {med} اتاخد.', 'ممتاز، {med} خلص.'],
  },
  reminder_snoozed: {
    en: ['No problem, I’ll remind you about {med} a little later.'],
    ar: ['ولا يهمك، هفكّرك بـ{med} كمان شوية.'],
  },
  reminder_failed: {
    en: ['I couldn’t save that just now. Please try again in a moment.'],
    ar: ['ما قدرتش أسجّل ده دلوقتي. جرّب تاني كمان شوية.'],
  },

  // ── Crisis (anyone) ─────────────────────────────────────────────────────────
  crisis_help: {
    en: [
      'I’m really glad you told me. You matter, and you don’t have to go through this alone. I’ve let your family know you need them now. Please call one of these numbers:',
    ],
    ar: [
      'أنا ممتن إنك قلتلي. إنت غالي، ومش لازم تعدّي ده لوحدك. بلّغت عيلتك إنك محتاجهم دلوقتي. من فضلك اتصل بواحد من الأرقام دي:',
    ],
  },
  c_crisis_help: {
    en: ['You matter, and you don’t have to carry this alone. Please reach out now — call one of these numbers:'],
    ar: ['إنت غالي، ومش لازم تشيل ده لوحدك. من فضلك اطلب مساعدة دلوقتي — اتصل بواحد من الأرقام دي:'],
  },

  // ── Caregivers and doctors, asking about the elder ──────────────────────────
  c_greeting: {
    en: ['Hello {me}. Ask me about {name}’s medicine or readings.'],
    ar: ['أهلاً يا {me}. اسألني عن دوا أو قياسات {name}.'],
  },
  c_help: {
    en: ['I can tell you about {name}’s medicine today and their latest readings. Their conversations with me stay private.'],
    ar: ['أقدر أقولك على دوا {name} النهارده وآخر قياساته. كلامه معايا بيفضل خاص بيه.'],
  },
  c_fallback: {
    en: ['Sorry, I didn’t understand. I can help with {name}’s medicine and readings.'],
    ar: ['معلش، ما فهمتش. أقدر أساعدك في دوا وقياسات {name}.'],
  },
  c_pick: {
    en: ['Who would you like to ask about?'],
    ar: ['عايز تسأل عن مين؟'],
  },
  c_meds_none: {
    en: ['{name} has no medicine scheduled today.'],
    ar: ['{name} ما عندوش دوا متسجّل النهارده.'],
  },
  c_meds_all_taken: {
    en: ['{name} has taken all {total} of today’s doses.'],
    ar: ['{name} خد كل جرعات النهارده ({total}).'],
  },
  c_meds_status: {
    en: ['{name} has taken {done} of {total} doses so far today.'],
    ar: ['{name} خد {done} من {total} جرعات لحد دلوقتي النهارده.'],
  },
  c_meds_due: {
    en: ['{med} was due at {time} and isn’t marked as taken yet.'],
    ar: ['{med} كان ميعاده الساعة {time} ولسه ما اتسجّلش إنه اتاخد.'],
  },
  c_meds_next: {
    en: ['Next: {med} at {time}.'],
    ar: ['اللي جاي: {med} الساعة {time}.'],
  },
  c_readings_none: {
    en: ['There are no readings from {name} yet.'],
    ar: ['لسه مفيش قياسات من {name}.'],
  },
  c_readings_values: {
    en: ['{name}’s latest readings: {values}.'],
    ar: ['آخر قياسات {name}: {values}.'],
  },
  c_readings_learning: {
    en: ['Rafiq is still learning {name}’s normal — day {day} of {of}.'],
    ar: ['رفيق لسه بيتعرّف على الطبيعي بتاع {name} — اليوم {day} من {of}.'],
  },
  c_readings_usual: {
    en: ['Compared with {name}’s usual, everything looks as normal.'],
    ar: ['مقارنةً بالمعتاد عند {name}، كله زي العادة.'],
  },
  c_readings_unusual: {
    en: ['Something looks unusual compared to {name}’s normal. Contact the doctor if you’re worried.'],
    ar: ['فيه حاجة مختلفة عن الطبيعي عند {name}. كلّم الدكتور لو قلقان.'],
  },
  c_readings_stale: {
    en: ['No new readings from {name} for a few days — the band may be off or uncharged.'],
    ar: ['مفيش قياسات جديدة من {name} من كام يوم — ممكن السوار مقلوع أو فاضي شحن.'],
  },
};

/** Crisis words, matched after normalisation (lib/rafiqChat/engine.ts normalise()).
 *  FOR THE FOUNDER TO REVIEW. The live list is app_config 'rafiq_chat'.crisis_words. */
export const CRISIS_WORDS: Record<Lang, string[]> = {
  en: [
    'want to die', 'wanna die', 'wish i was dead', 'wish i were dead', 'kill myself', 'end my life',
    'end it all', 'suicide', 'suicidal', 'hurt myself', 'harm myself', 'cut myself',
    'dont want to live', 'don’t want to live', 'no reason to live', 'better off dead', 'take my own life',
  ],
  ar: [
    'عايز اموت', 'عاوز اموت', 'عايزه اموت', 'عاوزه اموت', 'نفسي اموت', 'اريد ان اموت', 'اتمني الموت',
    'اموت نفسي', 'اقتل نفسي', 'انتحر', 'انتحار', 'انهي حياتي', 'اخلص من حياتي', 'اؤذي نفسي', 'اذي نفسي',
    'مش عايز اعيش', 'مش عاوز اعيش', 'مش عايزه اعيش', 'مش عاوزه اعيش', 'مليش لازمه', 'احسن لو مت',
  ],
};

export type HelpNumber = { label: Record<Lang, string>; phone: string };

/** Confirmed by the founder on 2026-11-01 (16328 called and answered). The live list
 *  is app_config 'rafiq_chat'.help_numbers (step32c); keep both the same. */
export const HELP_NUMBERS: HelpNumber[] = [
  { label: { en: 'Ambulance', ar: 'الإسعاف' }, phone: '123' },
  { label: { en: 'Mental health support (24/7)', ar: 'خط الدعم النفسي (24 ساعة)' }, phone: '16328' },
];
export const HELP_NUMBERS_ARE_PLACEHOLDERS = false;

/** What the server config may change; these are the built-in values. */
export type ChatConfig = {
  enabled: boolean;
  checkin_times: string[];      // local "HH:MM", Rafiq says hello if the elder hasn't written since
  quiet_start: string;          // no check-ins from …
  quiet_end: string;            // … until
  max_checkins: number;         // per day
  crisis_words: Record<Lang, string[]>;
  help_numbers: HelpNumber[];
};

export const DEFAULT_CONFIG: ChatConfig = {
  enabled: true,
  checkin_times: ['10:00', '19:00'],
  quiet_start: '22:00',
  quiet_end: '08:00',
  max_checkins: 3,
  crisis_words: CRISIS_WORDS,
  help_numbers: HELP_NUMBERS,
};
