# Rafiq ML — replace the LLM Rafiq with our own anomaly detection

_Step 0 plan, 2026-10-22. Approved by the founder the same day with the answers
in §7. Branch: `feature/rafiq-ml` (from `feature/bare-react-native`)._

Goal: Rafiq learns each elder's own "normal" from Salem Band data and flags
readings or trends that are unusual **for that person** — today vs. this week
vs. this month vs. earlier. No external AI APIs, no LLMs, no pre-trained
models. Our own code, our own trained model, scored in TypeScript inside
Supabase.

---

## 1. Inventory — the old Rafiq (LLM-based)

### 1.1 Edge functions (deployed on project `zslsukvrjafzfqybjsun`)

| Function | In repo | Uses | What it does | Plan |
|---|---|---|---|---|
| `ai-chat` v8 | `supabase/functions/ai-chat/index.ts` (281 lines) | Gemini 2.5 Flash (`GEMINI_API_1`), function-calling | Rafiq chat for elder/family/doctor; persists to `ai_conversations` + `ai_messages`; "call my son / message my daughter" actions via `resolve_contacts`; pulls `recent_health_context`, Trend Watch findings, medications | **Remove** (code + deployment) |
| `analyze-vitals` v5 | `supabase/functions/analyze-vitals/index.ts` (228) | Gemini | Called by trigger `tg_health_alert_fanout` after every non-band alert; writes an Arabic assessment to `ai_health_assessments` via `record_ai_assessment`; chains to `notify-fanout` | **Remove**; the trigger's step 2 is replaced (new migration) |
| `transcribe-audio` v3 | **not in repo** | OpenAI Whisper (`OPENAI_API_KEY`, currently invalid) | Voice messages in Rafiq chat | **Delete from the dashboard** (founder) |
| `tts` v1 | **not in repo** | OpenAI TTS | Reads Rafiq replies aloud (web) | **Delete from the dashboard** (founder) |
| `trend-watch` v3 | `supabase/functions/trend-watch/index.ts` (640) | Gemini for the *wording* only (`geminiJson`, 2 call sites), template fallback | Daily rules engine (not Rafiq) | **Decision needed — §3** |
| `agora-token` v8 | not in repo | Agora | Dormant (calls removed) | Delete from the dashboard (founder, optional) |
| `seed-vault-secrets` v3 | not in repo | — | One-time vault seeding | leave |
| `band-ingest`, `notify-fanout` | in repo | — | Band pipeline, push | **untouched** |

### 1.2 Shared modules and tests

| File | Used by | Plan |
|---|---|---|
| `_shared/chatTrendContext.ts` + `tests/chatTrendContext.test.ts` | ai-chat only | remove |
| `_shared/trendCompose.ts` + `tests/trendCompose.test.ts` | ai-chat **and** trend-watch (turns Gemini text into safe text) | remove if trend-watch stops using Gemini (§3), else keep |
| `_shared/safetyFilter.ts` + `tests/safetyFilter.test.ts` | trendCompose only | same as above |
| `_shared/trendText.ts`, `trendRules.ts` + tests | trend-watch (templates, rules) | **keep** — this is our own code and the base of Layer A |
| `_shared/alertLocation.ts`, `bandProtocol.ts`, `bandUpload.ts` | band pipeline | untouched |

### 1.3 Database (created from the dashboard before the migrations folder existed — no SQL in the repo)

| Object | Holds data? | Plan |
|---|---|---|
| table `ai_conversations`, `ai_messages` | yes — every Rafiq chat turn | **ask before dropping** (§5.3); default: a new migration *renames* them to `retired_ai_*` and revokes app access, drop later |
| table `ai_health_assessments` | yes — one row per assessed alert | same |
| rpc `record_ai_assessment` | — | drop (new migration). Known issue: callable with the public key (docs/HEALTH_CONTEXT_PERMISSION.md) |
| rpc `recent_ai_assessments` | — | drop; the app's 3 call sites go (§1.4) |
| rpc `resolve_contacts` | — | drop (ai-chat only) |
| rpc `recent_health_context` (step26e, service-role only) | — | drop (ai-chat + analyze-vitals only) |
| trigger fn `tg_health_alert_fanout` (step28a) | — | **new migration** re-creates it without the `analyze-vitals` call; the emergency-first push stays exactly as is |
| `care_circle_members.can_chat` / perm `'chat'` | — | leave (also gates in-app messaging) |
| `scripts/trend-watch/cleanup.sql` | — | drop the `ai_conversations` / `ai_messages` lines |

### 1.4 App — both roots: Expo app (`app/`, `lib/`, `components/`) and the bare RN app (`native/src/...`)

| File | Rafiq part | Plan |
|---|---|---|
| `app/chat.tsx` (576 lines) + route `/chat` | the whole screen | **remove**; route `/chat` → new `/rafiq` |
| `lib/useVoiceRecorder.ts` | recording for `transcribe-audio` | remove |
| `lib/useSpeech.ts` | reads Rafiq replies aloud (`tts` + device voice) | remove (nothing else uses it) |
| `lib/contactActions.ts` | dialer / SMS for Rafiq actions | remove (only chat.tsx uses it) |
| `lib/messages.ts` `sendInAppMessage` | Rafiq "message my son" | keep the function (messaging is core); fix the comment |
| `components/dashboard.tsx` | tab `rafiq` (icon message-circle) + "Rafiq AI Companion Report" card | tab stays, now opens `/rafiq`; card becomes "Rafiq" status card |
| `app/(elder)/index.tsx` | "Talk to Rafiq" tile → `/chat` | tile → "Rafiq" → `/rafiq` (status for the elder, gentle wording) |
| `app/(family)/index.tsx` | `recent_ai_assessments` → "Rafiq AI Companion Report" | → latest `rafiq_scores` level + reason |
| `app/(doctor)/index.tsx` | rafiq tab → `/chat` | → `/rafiq` |
| `app/(doctor)/patient/[id].tsx` | "AI assessments" section (`recent_ai_assessments`) | → "Rafiq" section: level, reasons, trend chart (no location — none exists in these tables) |
| `app/(family)/alerts.tsx` | `ai_explanation_ar`, `ai_recommended_action` from `recent_health_alerts` | columns come from a join to `ai_health_assessments` inside that RPC → new migration re-creates `recent_health_alerts` without them; alerts of kind `rafiq` show `reason_en/ar` |
| `app/plans.tsx` | "Full Rafiq AI companion" feature line | reword: "Rafiq insights" |
| `app/legal/privacy.tsx`, `terms.tsx` | "conversations with the Rafiq AI assistant", "Rafiq AI" | reword (lawyer reviews before release — flagged, not changed silently) |
| `lib/i18n.ts` | `trends.learning` "Rafiq is learning…" | keep (matches the new Rafiq) |
| `app/dev/trends-preview.tsx` | Trend Watch preview | keep |
| `native/src/...` mirrors of all of the above + `navigation/router.tsx`, `screens.tsx` | same | same changes; `/chat` route → `/rafiq` |

### 1.5 Secrets, env, dependencies

- App `.env` / `.env.example`: **no LLM key** (Gemini/OpenAI are edge-function secrets only). Nothing to remove there; `.env.example` text mentioning Rafiq AI gets reworded.
- `package.json` (both apps): **no LLM SDK** — Gemini is called with `fetch`. Nothing to uninstall.
- Edge-function secrets the founder can revoke **after** the functions are deleted/redeployed: `GEMINI_API_1` (Google AI Studio key), `OPENAI_API_KEY` (already invalid at OpenAI; delete the secret anyway), Agora app certificate if `agora-token` is deleted. I never print or commit any of them.

### 1.6 Docs mentioning the LLM Rafiq (to update at the end)

`ENGINEERING.md`, `SALEM_MASTER.md`, `SALEM_COMPLETE_GUIDE.md`, `docs/HEALTH_CONTEXT_PERMISSION.md`, `docs/TREND_WATCH.md`, `docs/NATIVE_SCREEN_STATUS.md`, `docs/NATIVE_REWRITE_PLAN.md`; `STEP10/11/12_SUMMARY.md` are history (leave, add a note). Business/marketing/launch plans are the founder's to reword.

---

## 2. Inventory — the band data Rafiq will learn from

Source of truth: `docs/BAND_PROTOCOL.md`, migrations step27a–f, `band_ingest()`.

| Data | Where | Shape | Cadence |
|---|---|---|---|
| Heart rate, SpO2 | `vitals` rows, `source='band'`, `kind` ∈ `heart_rate`, `spo2`; `value_numeric`, `unit`, `captured_at`, `is_resting`, `quality` (0–100; < 60 excluded from checks), `device_id` = band serial | one ~30 s measurement per 10-min block **only when still** (`is_resting=true`); `MEASURE_NOW` readings may be non-resting | ≤ 6/hour |
| Skin temperature | `vitals`, `kind='skin_temperature'` (°C) | every 10-min block | 6/hour |
| Activity | `vitals`, `kind='steps'` (per block, 0–3000) and `kind='movement'` (count per block) | every 10-min block | 6/hour |
| Falls, SOS, off/on wrist, low battery, charging, fall cancelled | `band_events` (`kind`, `band_time`, `occurred_at`, `data`, `flags`, `delayed`) | as they happen; replayed from the band's log if offline | event |
| Battery, worn state | `band_devices.battery_pct`, `is_charging`, `worn`, `last_record_at` | current state only | on upload |
| Daily aggregates | `vital_daily_summaries` (`metric` ∈ resting_hr, spo2, skin_temp, activity, night_restlessness, bp_systolic, glucose; `value, median, mean, min, max, total, n, enough`) | per elder per local day, refreshed for the last 3 days at 06:00 Cairo by `trend_watch_tick` | daily |
| Baselines (Trend Watch) | `trend_baselines` (median, MAD, low/high, learning state; window D-34…D-7) | per metric | daily |

Facts that shape the design:
- **Nothing is recorded off the wrist**, so gaps = not worn, not "no movement". Wear time is itself a feature.
- Raw band rows are deleted after **90 days**; daily summaries are kept for ever → 30-day baselines come from raw rows, longer comparisons from summaries.
- Readings reach Supabase in **batches** when the phone syncs (up to 48 h late). Scoring must re-run for the days a late batch touches (the same reason Trend Watch refreshes 3 days).
- Time of day uses the elder's `profiles.timezone`.
- The band has no GPS; location comes from the phone and lives in `alert_locations` / `location_pings` — Rafiq's tables never reference it, so doctors can't see location through Rafiq.
- Real-time safety already exists and stays: critical HR/SpO2 thresholds with 15-min confirmation, fall → 30 s "Are you OK?" → critical, SOS, off-wrist/no-data/low-battery info alerts. Rafiq must **not** duplicate those pushes.

---

## 3. Decision needed: Rafiq vs. Trend Watch

Trend Watch (step26, live) already does a daily per-person baseline (median + MAD over 28 days), 14-day learning, rule-based findings (info/warning), 72 h cooldown, weekly week-vs-week / month-vs-month summaries — i.e. most of Layer A at **daily** resolution. It also calls Gemini for the wording of each finding (template fallback), which conflicts with "no external AI".

| Option | What happens | Pros | Cons |
|---|---|---|---|
| **A. Merge (recommended)** | Rafiq becomes the one engine. Trend Watch's pure rules (`trendRules.ts`, `trendText.ts`, `trend_config`) move under Rafiq as part of Layer A; the `trend-watch` function's two Gemini calls are removed (templates only — they already exist); `trend_findings`/weekly summaries keep working and feed the Rafiq insights screen; the daily job becomes `rafiq-daily` | one engine, one screen, one set of thresholds; no external AI anywhere; reuses 700 lines of tested code | touches Trend Watch (earlier rule: don't). Changes are additive + removing Gemini; the rules and thresholds stay byte-for-byte |
| B. Side by side | Trend Watch untouched (still calls Gemini). Rafiq is a second engine on the same summaries | zero risk to Trend Watch | two engines can disagree; two screens; Gemini stays in production |
| C. Replace | Remove Trend Watch entirely, rebuild its rules inside Rafiq | cleanest | throws away tested, live code; a bigger migration |

Please pick A, B or C. The rest of this plan assumes **A**.

---

## 4. What gets built

### 4.1 Layer A — per-person baseline (TypeScript + Python twins, no libraries)

Per elder, per metric, per **segment**:
- metrics: `resting_hr`, `spo2`, `skin_temp`, `activity` (steps/10 min), `movement`, plus derived `wear_hours`, `night_restlessness`
- segments: time of day (night 22–06, morning 06–12, afternoon 12–18, evening 18–22, in the elder's timezone) × resting/active (from `is_resting`; activity metrics are not split)
- statistics, all robust: median, MAD → robust SD (1.4826·MAD) with the existing floors (`normal_floor_*`); EWMA (half-life 3 days) of the daily segment median; slopes over 7 and 30 days (Theil–Sen, robust to one bad day); day-to-day variability (IQR of daily medians); missing-data rate (blocks expected − blocks received, while worn)
- **deviation score** per metric per segment = (today's segment median − baseline median) / robust SD, clipped to ±6; sign kept (SpO2 down and HR up matter, the opposite rarely)
- baseline windows exactly as Trend Watch: D-34…D-7 for the baseline, last 7 days recent; learning until 14 "enough" days; `mark as expected` pause honoured
- runs: **daily** at 06:00 Cairo after `refresh_vital_daily_summaries` (full recompute, last 3 days), and **hourly** "today so far" scoring from raw rows (so a bad morning is seen before tomorrow)

### 4.2 Layer B — our own model: Isolation Forest (numpy only)

Why Isolation Forest, not an autoencoder:
- unsupervised: we have no real labels and won't for months; labels in the synthetic set are used only to evaluate and to calibrate the alert threshold
- trivial to implement in numpy (random splits, no gradients), trains in seconds on a laptop, retrains the same way on real data
- exports to plain JSON (a list of trees: feature index, threshold, left/right, leaf size) and scores in TypeScript with a few lines of tree traversal — **bit-exact** parity with Python is easy to test, which the plan requires; an autoencoder would need matching float behaviour of `tanh`/`exp` across two runtimes
- robust to feature scale and to missing features (handled as a learned "missing" value, −7, outside the clipped range)

Spec: 200 trees, sub-sample 256, max depth ⌈log₂256⌉ = 8, features below, seed fixed. Score = standard IF anomaly score in [0,1]; thresholds for watch/alert calibrated on the held-out synthetic set to hit a target false-alarm rate (≤ 1 false alert per elder per month at "alert"), reported per event type.

Features per (elder, day) — ~26, all from Layer A so the same code feeds both:
deviation of night resting HR, day resting HR, SpO2 median, SpO2 min, skin temp, activity total, movement total, night restlessness; 7-day and 30-day slopes of night resting HR, SpO2, skin temp, activity; variability of resting HR and SpO2; HR–activity residual (HR high while steps low); count of SpO2 dips < baseline − 4; longest awake-hours inactivity streak (blocks); wear hours; missing-data rate; fall event today (0/1) and movement in the 30 min after a fall; days since baseline reset; learning flag.

### 4.3 Synthetic data generator (`ml/rafiq/synth.py`)

- N elders (default 400 train / 100 held-out), ages 65–95, each with their own normal ranges drawn from plausible distributions (resting HR 52–88, SpO2 93–98, skin temp 32.5–35.5 °C, 1 500–9 000 steps/day), a daily circadian cycle (lower HR and temp at night), weekday/weekend activity, measurement noise, quality values, 10-minute blocks, resting-only HR/SpO2, wear gaps (nights off, charging, forgotten days), sensor dropouts, late batch uploads.
- Injected, **labelled** events (start day, length, type): slow rising resting HR over 4–10 days (+8…+18 bpm), SpO2 dips (nightly −3…−6 points for 3–6 nights), fever (skin temp +0.8…+1.8 °C, 2–5 days, with HR up), sudden inactivity (activity −60…−90 % for 2–7 days), fall followed by stillness (fall event + no movement 20–60 min), and normal-but-different "life" changes that must **not** alert (holiday with less activity but normal vitals; a new exercise habit).
- Output: Parquet-free plain CSV/JSON (numpy only) in the same shape as `vitals` / `band_events`, so the same loader serves synthetic and, later, real exports.

### 4.4 Layer C — decisions, text, alerts (TypeScript, in the edge function)

- level per elder per day: `normal` / `watch` / `alert` / `urgent`
  - `watch`: one metric deviates (|z| ≥ 2) for ≥ 2 days, or IF score ≥ t_watch
  - `alert`: Trend Watch rule fires (existing `trendRules.decide`) or IF score ≥ t_alert or two metrics deviate the same way for ≥ 3 days
  - `urgent`: only for what the real-time pipeline can't see — e.g. SpO2 median ≤ 90 for the night **and** resting HR up ≥ 15, or inactivity ≥ 6 awake hours with the band worn and no fall event. Falls, SOS and SpO2 < 88 are already pushed by `band_ingest` as critical and Rafiq **defers** to them (it records the level but sends no second push)
- reason text: every reason has a code + parameters, rendered in **English and Arabic** by templates (`_shared/rafiq/text.ts`, same style as `trendText.ts`): "Resting heart rate has been 12 bpm above Mona's usual for 4 nights" / "معدل نبض منى أثناء الراحة أعلى من معتادها بـ 12 نبضة منذ 4 ليالٍ". Every alert ends with: "This is unusual compared to their normal — not a diagnosis. Contact the doctor if you are worried." + the not-a-medical-device note
- notifications: `rafiq_alerts` row → `health_alerts` row of new kind `rafiq` (payload `no_fanout` so the old trigger path is skipped) → `notify-fanout` with `get_trend_recipients` routing (caregivers with read-health + doctors). Doctors never see location: Rafiq's tables have none and `notify-fanout` v5 already withholds it from doctors.
- rate limit: per elder, per metric, per level — at most one notification per 24 h and no re-notify while a `rafiq_alerts` row is open at the same or higher level; an elder gets at most 2 Rafiq notifications per day in total. `urgent` bypasses all of this. Auto-resolve after 3 normal days (same as Trend Watch).

### 4.5 Where things run

- **Training**: `ml/` (Python 3.9 + numpy 2.0, which this Mac has; `pytest` added to `ml/requirements.txt`). `python -m rafiq.train` → `ml/models/rafiq-v1.json` (~150 KB) + `ml/reports/eval-v1.md`.
- **Scoring**: new edge function `rafiq-score` (service-role only, like `trend-watch`), bundling `_shared/rafiq/model.json`; scheduled by a new `rafiq_tick()` (pg_cron + `_post_edge`, the pattern from step26d/27e): hourly intraday pass, and the 06:00 daily pass right after the summaries refresh (under option A the daily pass *is* the renamed trend-watch run). Model version recorded on every score row.
- **No Python in production.**

### 4.6 Folder layout

```
ml/
  README.md                 how to generate data, train, evaluate, export, retrain on real data
  requirements.txt          numpy, pytest
  rafiq/
    synth.py                synthetic elders + labelled events
    baseline.py             Layer A (mirrors _shared/rafiq/baseline.ts)
    features.py             26 features (mirrors features.ts)
    iforest.py              Isolation Forest from scratch
    train.py                train + calibrate thresholds → models/rafiq-vN.json
    evaluate.py             precision / recall / false-alarm per event type, held-out
    export_fixtures.py      writes fixtures/parity/*.json for the TS tests
  tests/                    pytest: baseline maths, iforest, synth invariants
  fixtures/parity/          inputs + expected outputs shared with vitest
  models/rafiq-v1.json
supabase/functions/
  _shared/rafiq/            baseline.ts, features.ts, iforest.ts, decide.ts, text.ts, model.json
  rafiq-score/index.ts
supabase/migrations/        step30a…30e (below)
tests/                      rafiqBaseline.test.ts, rafiqForest.test.ts (parity), rafiqDecide.test.ts,
                            rafiqText.test.ts, rafiqE2E.test.ts (synthetic elder through the TS pipeline)
scripts/rafiq/              run.mjs: `seed-synthetic --confirm` (TEST elder only, @salem.test),
                            `checks` (SQL, transaction rolled back), `replay`
app/rafiq.tsx, native/src/app/rafiq.tsx      Rafiq insights screen (+ components/rafiq/*)
docs/RAFIQ.md               how it works, thresholds, retraining
```

### 4.7 The new migrations (each small; none edits an existing file)

| Step | Content |
|---|---|
| `step30a_rafiq_enums` | `rafiq_level` enum (normal/watch/alert/urgent); `alert_kind` + `'rafiq'` (enum values must be added in their own transaction) |
| `step30b_rafiq_tables` | `rafiq_baselines (elder_id, metric, segment, median, mad, robust_sd, ewma, slope7, slope30, iqr, n_days, learning, computed_for, updated_at; PK elder_id, metric, segment)`; `rafiq_scores (id, elder_id, scored_for date, window 'day'|'intraday', features jsonb, deviations jsonb, model_score numeric, model_version text, level rafiq_level, reasons jsonb, created_at; unique (elder_id, scored_for, window))`; `rafiq_alerts (id, elder_id, level, metrics text[], reason_code, reason_params jsonb, reason_en, reason_ar, score_id → rafiq_scores, alert_id → health_alerts, status open/acknowledged/resolved, opened_for date, opened_at, last_notified_at, acknowledged_by/at, resolved_at)`; `rafiq_config (key, value, description)` seeded with thresholds; `rafiq_runs`. RLS: select for the elder (`auth.uid() = elder_id`), for circle members through the existing `security definer` helper `has_perm(elder,'health')` (caregivers with read-health **and** doctors — no location in any column); all writes service-role only. Retention: `rafiq_scores` intraday rows 90 days, daily rows kept |
| `step30c_rafiq_functions` | `rafiq_elders_due()`, `rafiq_record_alert()` (raises the `health_alerts` kind `rafiq` row with `no_fanout` and calls notify-fanout — same shape as `trend_watch` does), `recent_rafiq_alerts()`, rate-limit helper |
| `step30d_rafiq_schedule` | `rafiq_tick()` + pg_cron entries (hourly, and 06:00 Cairo daily) |
| `step30e_retire_llm_rafiq` | re-create `tg_health_alert_fanout` **without** the analyze-vitals call (emergency-first push unchanged); re-create `recent_health_alerts` without the `ai_*` join; drop `record_ai_assessment`, `recent_ai_assessments`, `resolve_contacts`, `recent_health_context`; **tables with data**: rename `ai_conversations`→`retired_ai_conversations`, `ai_messages`→`retired_ai_messages`, `ai_health_assessments`→`retired_ai_health_assessments` and revoke `anon`/`authenticated` — **only after the founder's explicit OK**; a later `step31_drop_retired` deletes them when the founder says so |

Under option A, a `step30f_trend_into_rafiq` adds `trend_findings.rafiq_alert_id` and points `trend_watch_tick` at `rafiq-score` (daily mode). No existing migration is edited.

### 4.8 Rafiq insights screen (replaces `/chat`)

- Header: Rafiq status today (level colour: normal `#3A9AFF` info blue, watch amber, alert/urgent red; brand indigo `#261CC1` header; `#F5F5F5` background), the plain-language reason, "learning day x of 14" while learning
- Per-metric cards: resting HR, SpO2, skin temperature, activity, night movement — today vs. the person's usual, with the usual range shaded (uses `trend_baselines`/`rafiq_baselines` low–high)
- Trend charts: day / week / month tabs; `react-native-svg` (already in both apps), no new chart library
- Alert history with reasons (EN/AR) and acknowledge; "mark as expected" (existing Trend Watch action)
- Fixed footer: "Rafiq compares readings with this person's own normal. It does not diagnose. Salem is not a medical device. Contact the doctor if you are worried." (EN + AR; wording to the lawyer)
- Elder view: softer — one line and the charts, no alert list; doctor view: same as family but never a location link (none exists)

### 4.9 Tests

- Python (`pytest`): baseline maths against hand-computed values; IF properties (anomalies score higher than inliers on toy data; deterministic with seed); synthetic generator invariants (ranges, resting-only HR/SpO2, no data off-wrist)
- TypeScript (`vitest`): same baseline cases; **parity** — the TS forest and baseline must reproduce the Python outputs on `ml/fixtures/parity/*.json` to 1e-9; decision table for Layer C (rate limit, urgent bypass, defer to real-time pipeline); EN/AR text for every reason code; **end-to-end**: a synthetic elder (CSV → the TS pipeline) with an injected rising-HR event produces `watch` then `alert` on the expected days and nothing on the control elder
- Live checks (SQL, rolled back, like `scripts/band/checks.sql`): RLS — elder sees own, caregiver without read-health sees nothing, doctor sees health rows but no location column exists anywhere; writes denied to app roles
- Existing `npm test` (6 suites, 204 tests) must stay green minus the two removed suites

### 4.10 Evaluation to report

On the held-out synthetic elders, per event type (rising HR, SpO2 dips, fever, inactivity, fall + stillness): precision, recall, days-to-detect, and false alarms per elder-month at the `watch` and `alert` thresholds; plus the non-event "life changes" false-alarm rate. Target: recall ≥ 0.85 for rising HR / SpO2 / fever / inactivity at `alert`, ≤ 1 false `alert` per elder-month. Falls are mostly the real-time pipeline's job; Rafiq's "fall + stillness" catches the band-didn't-detect-a-fall case through inactivity only, so expect lower recall there and say so.

---

## 5. Order of work (small commits, secret scan before each, no push)

1. Branch `feature/rafiq-ml` off **`feature/bare-react-native`** (it contains both app roots; the Expo-root changes also apply there). Confirm the base.
2. **Step 1 — remove**: app screens/libs in both roots → shared modules + tests → edge functions in repo → `step30e` migration (renames, not drops, for data tables) → docs. Redeploying / deleting edge functions on the dashboard is a backend-settings change: I prepare the exact list; the founder runs it (or OKs me running the MCP deploy, as before).
3. **Step 2 — build**: `ml/` generator → Layer A twins + tests → Isolation Forest + parity fixtures → train/evaluate/export v1 → `_shared/rafiq/*` + `rafiq-score` → migrations 30a–30d (+30f) → app screen in both roots → scripts (`seed-synthetic --confirm`) → docs.
4. Deliver: what was removed, what was built, the evaluation numbers, how to retrain, what needs real band data.

## 6. Questions for the founder (answer before Step 1)

1. **Trend Watch**: option A (merge, recommended), B or C? (§3)
2. **Base branch**: `feature/bare-react-native` (recommended) or `feature/band-trend-watch`?
3. **Old data tables** `ai_conversations`, `ai_messages`, `ai_health_assessments`: rename-and-lock now and drop later (recommended), drop now, or keep untouched?
4. **Dashboard actions** (yours, or say "do it" and I'll use the Supabase MCP): delete functions `ai-chat`, `analyze-vitals`, `transcribe-audio`, `tts` (and the dormant `agora-token`); then revoke `GEMINI_API_1` at Google AI Studio and delete the `OPENAI_API_KEY` secret.
5. **Doctor notifications**: Rafiq `alert`/`urgent` to caregivers with read-health **and** doctors (via `get_trend_recipients`), `watch` in-app only, no push — OK?
6. **Scoring cadence**: hourly intraday + daily 06:00 — OK, or daily only for the pilot (cheaper, simpler)?
7. The privacy/terms wording changes go to the lawyer first — confirm I should only *flag* them, not edit.

## 7. Founder's answers (2026-10-22)

1. **Trend Watch: A — merge into Rafiq.** Explicit yes to touch Trend Watch for
   this. Keep its tested rules, thresholds, 14-day learning and cooldown;
   remove only its two Gemini calls and use the templates for wording.
2. **Base branch:** `feature/bare-react-native` → `feature/rafiq-ml`.
3. **`ai_*` tables:** rename to `retired_*` and lock (no app access, RLS
   deny-all) in a new migration. **Nothing is dropped**; dropping is decided later.
4. **Deletions and key revocations are done by the founder**, not through the
   Supabase MCP. Order: (a) the new migration stops `tg_health_alert_fanout`
   calling `analyze-vitals`, and alerts still fan out normally without the AI
   assessment; (b) once that is ready and tested, the founder applies it, deletes
   `ai-chat`, `analyze-vitals`, `transcribe-audio`, `tts` and revokes
   `GEMINI_API_1` and `OPENAI_API_KEY`; (c) a short checklist with the exact names.
5. **Push routing:** `alert` and `urgent` → caregivers with read-health and linked
   doctors (never location to doctors); `watch` in-app only.
6. **Scoring: daily only for the pilot**, every morning ~07:00 Cairo, covering the
   previous day plus the night. Hourly scoring must be switchable later in
   `rafiq_config`.
7. **Legal text is not edited.** Every mention of AI chat, voice, Gemini or OpenAI
   and what should change goes into `docs/RAFIQ_LEGAL_NOTES.md` for the lawyer.
   Normal UI copy (plan feature lists, tiles) may be updated.

Also: remove the old Rafiq from both the Expo root and `native/`; the plan file is
the first commit on the branch; the Android/Firebase and iOS push-tap threads stay
paused; stop after the migrations and the trigger change, before building the model.

## 8. Founder checklist — retiring the LLM Rafiq (step b)

Ready 2026-10-22. Do these **in order**. None of them is done by Claude.

1. **Apply migration `supabase/migrations/20261022090000_step30a_retire_llm_rafiq.sql`**
   — on its own (Supabase dashboard → SQL editor → paste the file → Run).
   Don't use `supabase db push` yet: it would also apply 30b–30d, which you
   haven't reviewed. (30b–30d are safe whenever you're ready — they only create
   empty tables and functions; nothing runs until a later schedule migration.)
   From this moment alerts no longer wait for or depend on an AI; the old chat
   stops working (its tables are renamed).
2. **Check it**: SQL editor → paste `scripts/rafiq/check-step30a.sql` → Run.
   All 11 rows must say `ok = true`. It's read-only (no rows written, no push).
   **If anything looks wrong at this point**, undo step 1 with
   `scripts/rafiq/rollback-step30a.sql` (SQL editor → paste → Run; one
   transaction, keeps every row, safe to run twice). The rollback is only safe
   **before step 3**: after it, non-emergency alerts depend on `analyze-vitals`
   again, so once that function or the Gemini key is gone, don't roll back.
3. **Delete these edge functions** (dashboard → Edge Functions → function →
   Delete):
   - `ai-chat`
   - `analyze-vitals`
   - `transcribe-audio`
   - `tts`
   - optional, dormant since calls were removed: `agora-token`
4. **Delete these edge-function secrets** (dashboard → Edge Functions →
   Secrets):
   - `GEMINI_API_1`
   - `OPENAI_API_KEY`
5. **Revoke the keys at the source**, so they're dead even if a copy exists
   somewhere:
   - Google AI Studio (aistudio.google.com) → API keys → delete the key that
     was in `GEMINI_API_1` (check its Google Cloud project for any billing).
   - OpenAI (platform.openai.com) → API keys → delete the key that was in
     `OPENAI_API_KEY` (it was already rejected as invalid; delete it anyway).
   - If you delete `agora-token`: Agora console → rotate the app certificate.
6. **Redeploy `trend-watch` from this branch** when you merge (it no longer
   calls Gemini). Until then the deployed version falls back to its templates
   by itself once `GEMINI_API_1` is gone — no error, no missed alert.

**Leave alone:** `notify-fanout`, `band-ingest`, `trend-watch` (except step 6),
`seed-vault-secrets`, the secrets `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`,
`SUPABASE_*`, and the vault secret `salem_service_role_key`.

**Good to know:** an old app build that still calls `recent_ai_assessments`
(the family home's "Rafiq AI Companion Report", the doctor's "AI assessments")
just shows nothing there after step 1; alert lists keep working (same
columns, the AI ones are empty).

## 9. Step 2 status (2026-10-23)

Built on `feature/rafiq-ml`; **nothing applied to the database, nothing deployed,
nothing scheduled.**

| Part | Where | State |
|---|---|---|
| Synthetic band data with labelled events and decoys | `ml/rafiq/synth.py` | done |
| Layer A (Rafiq day 07:00→07:00, personal baselines, z, slopes, EWMA, 20 features) | `ml/rafiq/core.py` ⇄ `_shared/rafiq/core.ts` | done, bit-identical |
| Layer B: Isolation Forest from scratch (100 trees × 256) | `ml/rafiq/iforest.py` ⇄ `_shared/rafiq/forest.ts`, `model.json` | done, bit-identical |
| Layer C decision + EN/AR reasons | `core.py`/`core.ts`, `_shared/rafiq/text.ts` | done |
| Evaluation on 150 held-out elders | `ml/reports/rafiq-v1.md` | done |
| Trend Watch merged (logic moved unchanged) | `_shared/trendWatchRun.ts` | done |
| `rafiq-score` edge function (daily / intraday / replay) | `supabase/functions/rafiq-score` | written, **not deployed** |
| Insights screen, both apps; alert lists link to Rafiq; doctor patient file button | `app/rafiq.tsx`, `native/src/app/rafiq.tsx` | done |
| Tests | Python 18; TS parity 19, text 26, end-to-end 9, SQL 69 | all pass |

Founder checks for each migration: `scripts/rafiq/check-step30b.sql`,
`check-step30c.sql`, `check-step30d.sql`, `check-step30e.sql` (read-only;
every row ok = true).

**step30e (2026-10-23)**: on salem-prod, check-step30c found `authenticated`
with REFERENCES and TRIGGER on four Rafiq tables — Supabase's default
privileges, which the test database didn't have. step30e revokes REFERENCES,
TRIGGER and TRUNCATE (and re-asserts no writes) from anon / authenticated;
after it check-step30c is 12/12. The test harness now has Supabase's default
privileges, so this kind of gap fails a test.

Changed in step30b–d while still unapplied: `rafiq_baselines` now holds the
model's nine metrics; `notify_cooldown_hours` is 72 (as Trend Watch) — a reason
that stays the same is not pushed again daily.

Done by 2026-10-30 (founder): step30b–30e applied and checked; `rafiq-score`
(v2) and `trend-watch` (v4) deployed; the synthetic replay below ran on
salem-prod (model check ok, 60 days, activity + fever alerts, warm spell quiet).

**Still to do, in order, each after the founder's OK:**
1. ~~Apply step30b–30d~~ (done, plus step30e privileges).
2. ~~Deploy `rafiq-score` and the refactored `trend-watch`~~ (done).
3. ~~Replay~~ (done) — replay the synthetic TEST elder (`test-account@salem.test`), with
   `SUPABASE_DB_URL` in `.env`:
   ```
   node scripts/rafiq/run.mjs seed    --confirm   # 61 days of synthetic band rows (device SB-SYNTH-RAFIQ)
   node scripts/rafiq/run.mjs replay  --confirm   # rafiq-score over the last 60 days (add --no-notify for scores only)
   node scripts/rafiq/run.mjs cleanup --confirm   # removes only what these wrote
   ```
   Every write refuses unless the elder's email ends in @salem.test; with
   notifications on it also refuses if anyone in that elder's circle isn't a
   @salem.test account. Expected: ~15 learning days, an activity alert around
   4 weeks ago, a quiet warm spell, a fever alert 2–4 days ago.
4. **The schedule migration — step30f** (`20261030090000_step30f_rafiq_schedule.sql`,
   written 2026-10-30, applied by the founder): cron `salem_rafiq_tick` every
   hour at :15 → `rafiq_tick()` acts once a day at 07:15 Cairo (summer time
   handled) and posts the daily pass to `rafiq-score`, which runs Trend Watch
   first, then Rafiq. `salem_trend_watch_tick` is unscheduled so Trend Watch
   never runs twice (it moves from 06:00 to ~07:15 Cairo); the hourly pass stays
   off. Check: `scripts/rafiq/check-step30f.sql` (8 rows; check-step30d rows 8–9
   turn false, as expected). The morning's result is logged in `rafiq_runs.result`
   (Trend Watch's own `trend_runs` no longer gets a daily row). Undo: in the
   migration's header.
