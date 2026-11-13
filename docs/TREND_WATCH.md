# Trend Watch

Rafiq learns each elder's own "normal" from their readings and tells the
caregiver and the doctor, in plain words, when a change lasts several days.
It never diagnoses, never predicts, never touches medicines, and never raises a
critical alert (critical stays with the real-time thresholds and SOS).

## How it runs

```
06:00 Cairo (hourly cron → trend_watch_tick → only acts at 06:00, once a day)
  └─ edge function trend-watch
       1. refresh_vital_daily_summaries(elder, last 3 days)   ← late band uploads count
       2. baselines: days D-34…D-7, median + MAD; learning until 14 good days
       3. rules (supabase/functions/_shared/trendRules.ts), thresholds from trend_config
       4. trend_findings: open / update / resolve (one open per metric, 72 h cooldown)
       5. health_alerts row kind 'trend' with payload.no_fanout
          → analyze-vitals is NOT triggered; notify-fanout is called directly
          with get_trend_recipients (info → primary caretaker;
          warning → caretaker + family + doctor)
       6. Gemini writes EN + AR; safety filter; template on any failure
       7. Sundays: weekly summary → caregivers' in-app notifications + doctor's file
```

The push text is always the fixed template (it fits, and it can't fail). The
AI text only replaces the in-app explanation, and only after it passes the
filter. Every message ends with the disclaimer, added after the check.

## Where things are

| What | Where |
|---|---|
| Rules, baselines, cooldown, resolve | `supabase/functions/_shared/trendRules.ts` |
| Safety filter (EN + AR, own medicines) | `supabase/functions/_shared/safetyFilter.ts` |
| Fixed wording, next steps, disclaimer | `supabase/functions/_shared/trendText.ts` |
| AI-or-template gate | `supabase/functions/_shared/trendCompose.ts` |
| When Rafiq chat gets trend context | `supabase/functions/_shared/chatTrendContext.ts` |
| Nightly job | `supabase/functions/trend-watch/index.ts` |
| Thresholds (advisor-editable) | table `trend_config` |
| Screens | `components/trends/*`, `app/trends/[elderId].tsx`, doctor patient file "Trends" tab, elder Home + Settings |
| Migrations | `step26a`–`step26e` in `supabase/migrations/` |

## Tuning (medical advisor)

Change a number in `trend_config` (Supabase → Table editor). It applies at the
next 06:00 run; no code change, no deploy. Every key has a description.

## Running the tests

```bash
npm test                                   # 143 unit tests: rules, filter, chat intent
```

Live checks against the database. They need `SUPABASE_DB_URL`, from the Supabase
dashboard → Project Settings → Database → Connection string. Keep it in `.env`,
never in git.

```bash
node scripts/trend-watch/run.mjs seed --confirm      # test elder + 45 days of band-style data
node scripts/trend-watch/run.mjs replay --confirm    # run Trend Watch day by day over it
node scripts/trend-watch/run.mjs permissions         # 35 checks: who sees what (rolled back)
node scripts/trend-watch/run.mjs regression          # 27 checks: alerts/SOS/reminders unchanged
node scripts/trend-watch/run.mjs cleanup --confirm   # removes ONLY the test users' rows
```

The test data belongs to `test-account@salem.test` ("TEST – Trend Watch") plus
three test circle members (`test-account+caregiver@`, `+nohealth@`,
`test-account+doctor@salem.test`), all with fixed IDs `7e57e1de-…`.

## Preview without signing in

`/dev/trends-preview` (development builds only) renders the real cards from
sample data.
