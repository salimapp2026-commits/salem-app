# Rafiq rebuild — notes for the lawyer

_Prepared 2026-10-22 on branch `feature/rafiq-ml`. The legal text in the app has
**not** been changed; this lists what is now inaccurate and a suggested
direction. Final wording is the lawyer's._

## What changed in the product

| Before | After |
|---|---|
| **Rafiq** was an AI chat assistant (Google Gemini). Elders, family and doctors typed or spoke to it; it answered health questions, read photos/reports, and could start a call or text to a contact. | **The chat is removed.** Rafiq is now an automatic analysis of Salem Band readings: it learns each person's own usual range and flags readings that are unusual **for that person** (e.g. "resting heart rate 12 bpm above her usual for 4 nights"). No chat, no voice, no photos. |
| Every health alert was sent to **Google Gemini** for an Arabic "assessment", stored and shown to family and doctors. | Alerts are no longer sent to any AI. They go out with fixed wording. |
| Voice messages were transcribed by **OpenAI Whisper**; replies could be read aloud by **OpenAI** text-to-speech. | Removed. |
| Trend Watch (weekly/trend summaries) asked **Google Gemini** to word its findings. | Fixed templates only. |
| — | **No health data is sent to any outside AI provider** once the founder deletes the old functions and keys (checklist in `docs/RAFIQ_ML_PLAN.md` §8). |

Rafiq's analysis is our own code and our own trained statistical model, run on
our own database servers (Supabase, EU — eu-central-1). It never names a
condition, never predicts a disease, and every Rafiq message says it is
"unusual compared to their normal, not a diagnosis — contact the doctor if you
are worried". Doctors never see location through Rafiq.

**Old data:** past Rafiq chats and Gemini assessments are **kept, locked** (no
one can see them in the app), still included when a person downloads their
data, and still erased when a person deletes their account. Whether and when to
delete them entirely is an open decision for the founder — the lawyer may want
to advise (retention / purpose limitation).

## Places that are now inaccurate

The same two screens exist in both app versions (`app/legal/…` and
`native/src/app/legal/…`, identical text).

### Privacy policy — `app/legal/privacy.tsx`

| Where | Current text (summary) | Why it's now wrong | Suggested direction |
|---|---|---|---|
| "Data we collect" (line ~38) | "Content: your conversations with the Rafiq AI assistant, and any photos you upload." | No AI conversations any more. | Remove the AI conversations part (keep photos). Possibly add: conversations from before [date] are kept, locked, until deleted. |
| "What we do not collect" (line ~46) | "When Rafiq helps a senior reach someone, it opens the phone's own dialer or SMS app…" | Rafiq no longer starts calls or texts. | Remove that sentence (the "no in-app calls" statement stays true). |
| "How we use your data" (line ~54) | "…and producing Rafiq's summaries." | Rafiq is now automated analysis of health data. | Describe it: comparing band readings with the person's own usual range to flag unusual changes and alert the care circle. Consider whether this is "profiling" of special-category (health) data under GDPR art. 4(4)/9 and Egypt's PDPL, and whether art. 22 applies (we think not: no decision with legal or similarly significant effect is taken automatically — a person always decides — but this is the lawyer's call). |
| "Data sharing" (line ~61) | "…trusted service providers (hosting, push notifications, AI services)…" | No AI service providers any more. | Remove "AI services". Hosting (Supabase) and push (OneSignal) remain. Possibly note that until [date] Google (Gemini) and OpenAI processed chat content, alerts and voice. |

### Terms of use — `app/legal/terms.tsx`

| Where | Current text (summary) | Why it's now wrong | Suggested direction |
|---|---|---|---|
| "Important medical disclaimer" (line ~26) | "The Rafiq AI companion provides general information only — it does not diagnose…" | Rafiq is no longer a companion that gives information. | E.g. "Rafiq compares readings with the person's own usual range and flags changes. It does not diagnose, predict or treat, and Salem is not a medical device. In an emergency call emergency services; always consult a doctor." |
| "Limitation of liability" (line ~65) | "…relying on the AI companion's information…" | Same. | "…relying on Rafiq's insights or alerts, or on their absence…" (an alert that *doesn't* come is the new risk). |

## New wording the lawyer should review

These are in the app now (UI copy, not legal text) and will appear on every
Rafiq screen and alert:

- Rafiq screen footer (`app/rafiq.tsx`, both versions): _"Rafiq compares
  readings with this person's own normal. It does not diagnose, and Salem is not
  a medical device. Contact the doctor if you are worried."_
- Every Rafiq alert ends with: _"This is unusual compared to their normal, not a
  diagnosis. Contact the doctor if you are worried."_ (English and Arabic;
  final text in `supabase/functions/_shared/rafiq/text.ts`, step 2).
- Plan feature lists (`app/plans.tsx`): "limited AI", "Monthly token update",
  "Full Rafiq AI companion", "Voice in and read-aloud", "Unlimited AI",
  "3-day AI token update" were removed or replaced by "Rafiq alerts when
  readings are unusual for them" and "Rafiq insights: day, week and month
  trends". Pricing itself is unchanged.

## Questions worth the lawyer's attention

1. **Medical-device status.** Software that analyses physiological signals and
   flags anomalies can fall under medical-device rules (EU MDR rule 11; the
   Egyptian Drug Authority's rules for software as a medical device). Is "not a
   medical device" defensible for Rafiq's wording and claims, and what must we
   avoid saying in marketing?
2. **Automated processing of health data** — lawful basis, transparency text,
   and whether a separate consent is needed for Rafiq (it can be designed to be
   switched off per elder if needed).
3. **Retention of the retired AI chats and assessments** (see "Old data").
4. **Store listings** (App Store / Google Play) and marketing texts that mention
   an AI companion or chat need the same changes — not in this repo
   (`MARKETING_PLAN.md`, `BUSINESS_PLAN.md` also mention the old Rafiq).
