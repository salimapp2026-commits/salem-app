# Rafiq — evaluation results (simulated data)

> **All numbers on this page come from simulated elders, not real patients.**
> Salem has no real band data yet. These results show that the design works
> as intended; real-world performance will be measured in the pilot.

## What Rafiq is

Rafiq is Salem's own early-warning system. It learns **each elder's personal
normal** from their Salem Band (resting heart rate, oxygen, skin temperature,
activity, wear time) and tells the family and the doctor when something is
unusual **for that person** — for example *"Mona's resting heart rate has been
12 bpm above their usual (62 bpm) for 4 nights."*

- **Our own technology.** Personal baselines plus a machine-learning model
  (an Isolation Forest) that we wrote and trained ourselves. No ChatGPT, no
  Gemini, no outside AI service, no borrowed model.
- **It never diagnoses.** Every message ends with *"This is unusual compared to
  their normal — it is not a diagnosis. Contact the doctor if you are worried."*
  Salem is not a medical device.
- **It respects privacy.** Doctors never see location; only care-circle
  members who have been given health permission can read it.

## How we tested it

We built a simulator of **550 elders** (ages 65–95), each with their own
normal heart rate, oxygen, temperature, activity, sleep times and habits —
including real-life messiness: forgetting the band, charging it, taking it off
at night, weak sensor readings. Into their data we hid **five kinds of
events** that a family would want to know about, and **five kinds of
"decoys"** — ordinary life that should *not* cause an alarm.

Rafiq was trained on 300 elders, tuned on 100 others, and then tested on
**150 elders it had never seen** — about **2,270 weeks** of simulated life.

## Results on the 150 unseen elders

| Event hidden in the data | How often Rafiq alerted the family | How soon |
|---|---|---|
| Resting heart rate slowly rising over days | **93%** | median 5 days |
| Oxygen dropping at night | **85%** | median 2 nights |
| Signs of fever (warmer skin + faster heart) | **95%** | next morning |
| Sudden drop in activity | **86%** | median 2 days |
| A fall followed by lying still | **100%** | next morning* |

| Trust and noise | Result |
|---|---|
| Alerts that were about something real | **94%** |
| False alerts per elder | **fewer than one every 2½ years** (0.007 per week) |
| Ordinary life (holiday, new exercise, a bad night, hot weather, a cancelled fall) that caused an alert | **2 of 137** decoys |

\* Falls are already handled **in real time** by the band (it alerts the
family within a minute unless the elder presses "I'm OK"). Rafiq adds a review
the next morning.

## What this means in plain words

- When something real changes, Rafiq **usually notices within a day or two** —
  slow changes like a gradually rising heart rate take a few days, on purpose,
  because one bad night is not a trend.
- When Rafiq sends an alert, it is **almost always worth looking at**.
- Families are **not flooded**: one alert per illness, never the same alert
  twice within 72 hours, at most two a day — except urgent ones, which always
  go out.
- Normal life — a holiday, a new walking habit, a hot day — **almost never**
  triggers an alert.

## Honest limits

- The data is **simulated**. Real wrist sensors are noisier, and real elders
  vary in ways a simulator cannot fully capture.
- The thresholds were tuned on simulated data; they will be **re-tuned with
  real band data** during the pilot (the system is built to be retrained).
- Oxygen changes are missed mostly for elders who take the band off at night —
  Rafiq cannot judge a night it did not see.
- Rafiq supports families and doctors; it **does not replace medical care**.

---
*Simulated data. Model `rafiq-v1`, evaluated 2026-10-23. Full technical report:
`ml/reports/rafiq-v1.md`.*
