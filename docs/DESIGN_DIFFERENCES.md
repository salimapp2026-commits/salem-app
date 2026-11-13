# Where the app differs from the Figma design, and why

For our designer, so Figma can be updated to match what ships. Figma file:
"Salem UI&UX" (`vnxTmpCv5PGenEhx6QP6Qy`). Everything not listed here matches
the frame: colours, fonts, sizes, spacing, corner radius and icons are read
from the file through the Figma API and live in one place,
`native/src/theme/tokens.ts`.

Each line: **frame → what the app does instead → why**.

## All screens
- **Arabic** → every screen is mirrored right to left with the same components;
  Arabic text uses Noto Sans Arabic at the frame's sizes, English uses Inter at
  the same sizes. Numbers ("78 bpm", "120/80") and "SOS" stay in Inter in both
  languages. → The frames are in English; families choose their language.
- **Elder text size** → the frame's sizes are the minimum; elders can make text
  larger in Android settings and the layout grows with it. Elder buttons are at
  least 64 high (the 60-high "remind me" becomes 64). → Brand rule for elders.
- **Tab bar** → Elder: Home · Rafiq · More (no Location). Caregiver: Home ·
  Rafiq · Location · More. Doctor: Home · Rafiq · More (no Location). The design
  shows four tabs everywhere. → Founder decision 2026-10-31; doctors never see
  location.
- **Back button on a home screen** → not shown on the elder home (it is the first
  screen; there is nothing to go back to). Shown on every other screen.
- **Status bar and home indicator** → drawn by Android, not by the app.
- **"Choose Your Plan", "Choose Your Payment Method"** and the blank scaffold
  frames → not in the beta.

## Elder home (`Elder home , medication checklist& care circle`)
- **Wordmark** → the app's own `wordmark-white.png`, 200×72, at the end of the
  first row (the Figma image is a low-resolution cut-out of the same wordmark).
- **"band is connected" badge** → only for the Salem Band, and only when it sent
  a reading in the last 3 hours. A Salem Band silent for longer: lavender "No band
  readings right now". → Never claim a connection we can't see.
- **Health Connect families (Mi Band, Samsung, …)** → the badge says
  "Last sync · {time}" in neutral lavender, never a warning colour, however old.
  Same line under "You" in the care circle. → Their readings reach Salem only when
  the app opens, so "connected" would look broken most of the day (founder,
  2026-11-01).
- **No band at all** → no badge. → Nothing to report; a warning would be noise.
- **Heart rate card** → the newest real reading and bars of the last 9 readings;
  "No reading yet" when there is none.
- **Pressure "120/80 · Normal"** → hidden unless a real blood-pressure reading
  exists; then it shows the reading and when it was measured, without "Normal".
  → Never sample numbers for families (founder); Salem never judges a value
  (Rafiq never diagnoses).
- **Activity "2,400 · Goal: 4k steps"** → today's real steps and "Steps today".
  No goal. → There is no step goal in Salem; a made-up goal would be a fake number.
- **Stat cards** → a third of the row each, as in the frame (111 of 393), so
  wider phones get wider cards and "HEART RATE" fits; when pressure is hidden the
  two others keep that width.
- **Dose cards** → second line is the scheduled time ("at 08:00") instead of
  "after breakfast". → Reminders store a time, not a meal.
  Skipped and missed doses say so; they never look taken.
- **"you have taken all your medications"** → only when every dose today is
  taken. "No medicines scheduled for today" when there are none (not in the design).
- **"Did you take m3 dose?"** → asks about the earliest dose that is due and not
  answered, by name. "✓ took it" marks it taken; "remind me" snoozes it.
  (Open question to the founder: the reminder push has a third button, "Not yet".)
- **Care circle** → the caregiver corner is the primary caretaker (or the first
  family member); names come from the circle; initials replace "Cg"/"Dr." when a
  name exists; "No caregiver yet" / "No doctor yet" when the corner is empty.
  The triangle is drawn to the frame's coordinates and centred on wider phones.
- **"Call your care giver" / "Call  your Dr"** → shown only when that person has
  a phone number in Salem; opens the phone's dialer with it (no in-app calling).
  The phone icon is indigo — in the frame it is white on white and invisible.
- **Not on the design's elder home, kept one tap away under More**: messages,
  notifications, today's reminders, my medications, add a reading, pair a family
  device, settings. → Messaging is core and must stay reachable.

## Caregiver home (`care giver home`)
- **No SOS pill** → as in the frame. (The old header SOS on caregiver and doctor
  phones raised the SOS for the caregiver's own account, alerting nobody useful;
  SOS is the elder's button.)
- **Bell** → the blue 36 circle as in the frame; the bell has a dot only when
  something is unread. Opens notifications.
- **"Papa's Health · ● Connected"** → the elder's name from the circle. "● Connected"
  (green) only for a Salem Band with a reading in the last 3 hours; a Health
  Connect family sees "Last sync · {time}" in light blue, never a warning colour;
  no band → nothing.
- **Stat cards** → the same rules as the elder home: real readings only, pressure
  hidden without one, no "Normal", no step goal.
- **"Rafiq AI Companion Report"** → "Rafiq Companion Report" with Rafiq's health
  status for the elder (learning day x of 7 / as usual / something to watch /
  needs your attention, with the reason) and, once the mood check-in ships, the
  mood summary. Never conversation content. → Caregivers never see the elder's
  chats (founder, 2026-10-31). "AI" dropped: Rafiq is Salem's own model, not a chat AI.
- **"Current Location · LIVE"** → "Last known location · {time}" and the safe-zone
  name when the elder is inside one ("Home"), otherwise "Tap to open the map".
  No "LIVE". Shown only to members with the location permission. → There is no
  live tracking (founder, 2026-10-31).
- **"Adherence Rate Today 85 % · 3 out of 4 …"** → today's real medicine doses;
  "No medicines scheduled for today" instead of a bar when there are none.
- **Not on the frame, under More**: messages, alerts, notifications, the care
  circle, doctor visits, settings.

## Rafiq chat (`05 · Rafiq text conversation`) and talk (`04 · Rafiq voice and mood`)
- **"Rafiq AI"** → "Rafiq". → Rafiq is Salem's own rules (and later its own model), not a chat AI.
- **Video, microphone, emoji and image buttons** → removed. → No in-app calls, no voice
  input, no photos to Rafiq (founder, Q4).
- **Phone icon** → opens the phone's dialer: the elder's to their caregiver, a
  caregiver's to the elder. Hidden when there is no number in Salem, and for doctors.
- **SOS pill** → elders only, as on every screen.
- **Rafiq's flame under its messages** → the flame is in the header only; a small
  speaker button sits next to every Rafiq message instead (read aloud). → Founder:
  read-aloud on every Rafiq message.
- **"Message..." field** → a send button next to it (the frame has none once the
  microphone is gone). Messages are kept on the phone only; a line above the chat
  says so ("Your family sees only your mood"). → Chats stay private to the elder.
- **Under Rafiq's latest message** → suggestion buttons (my medicine, my readings, how
  I feel; for caregivers: {name}'s medicine, readings, Rafiq details). Medicine
  reminders carry the elder card's two buttons (✓ took it / remind me); check-ins carry
  three mood faces. Elder buttons are at least 64 high. → Not in the frame; phase 1
  answers only what it can answer from real data.
- **Crisis** → a red "Call · {name} · {number}" button per help number under Rafiq's
  answer. → The agreed crisis flow; the numbers are placeholders until the founder
  confirms them.
- **"talk": "Rafiq is listening…", the orb, "End Conversation"** → "Tap to hear Rafiq's
  last message", the flame (the orb is a later swap), the nine wave bars moving only
  while the phone reads aloud, a blue "Read aloud" button that becomes the red "Stop
  reading" pill (the frame's red pill and phone-off icon), and the three mood faces
  when Rafiq has asked how the elder feels. The tab icon is a speaker, not a
  microphone. → No voice input (founder, Q4); the phone's own text-to-speech.
- **Caregivers and doctors** → the same screen; Rafiq answers about the elder they look
  after (several elders: name buttons above the chat). No mood faces.
- **Under the three mood faces (elder)** → a small grey line: "If you choose "Not good",
  Salem will let your family know. You can turn this off in Settings." Settings has
  "Mood · Tell my family when I choose "Not good"" (on by default). Hidden when the
  elder turned it off. → Founder, 2026-11-08: the elder should know before tapping.

## Medicine times (not in the file)
- **No frame** → "Medicine times" under More, for the elder and the primary caretaker
  only (other caregivers and doctors don't see it): the current medicines with their
  times and a **Stop** link, then "Add a medicine" — name, dose (optional), times of day
  as chips (+08:00 / +14:00 / +20:00, or type one), **Save medicine**. Built from the
  existing card, chip and button styles. → Founder, 2026-11-04: families had no way to
  add a medicine reminder. Needs a frame.

## Linking a family member (`Accounts link`, `QR link`)
- **Two entries, for every role** → "Add a family member" and "Be invited by a family
  member", under More (elder, caregiver); a doctor's patient list keeps "Accept a
  patient invite", which opens "Be invited". → Founder, 2026-11-01.
- **"Senior Pairing" / "Share this code with your family"** → "Add a family member":
  first "Who are you adding?" — a caregiver or a doctor (not in the frame); then the
  frame's code screen with a white **Share code** button (WhatsApp etc.), a 15-minute
  countdown in "Waiting for connection…", and **New code** once it expires. Only the
  elder and the primary caretaker add members to a circle; any other caregiver sees only
  "My parent" (the parent types the code on their own phone), with a line saying why.
  Doctors can't add anyone and are told so. A family member who joins sees readings and
  location but can't add or remove members. → Founder L1, L2, 2026-11-01.
- **"Your caregiver needs this four-digit number"** → says who types it, where, and that
  it works once for 15 minutes.
- **"Scan your parent's code", the camera box, "Or enter code manually"** → "Type the
  code you received": the frame's four digit blocks become the typing field (Arabic
  digits work too), then "Join {name}'s care circle as a caregiver?" with who sent it,
  and Join / Cancel. → No camera, no scanning (founder).
- **Close button (dark ✕)** → the white round back button of the "Accounts link" frame,
  the same on both screens.
- **Wrong codes** → a plain message; after 5 wrong codes in 15 minutes, "wait 15 minutes".
- **Caregiver home with no elder yet** (not in the design) → "No one in your care circle
  yet" with an **Add a family member** button.
