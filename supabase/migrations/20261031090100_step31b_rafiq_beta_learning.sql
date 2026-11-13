-- step31b — Rafiq's learning period for the beta: 7 days (founder, 2026-10-31).
--
-- Needs rafiq-score with withConfig() deployed first (this commit): before it,
-- rafiq_config's learning keys were ignored and this changes nothing.
--
--   learning_min_days 14 → 7   days worn long enough before Rafiq may say anything
--   recent_days        7 → 2   the newest days kept out of "their normal". With 7,
--                              a normal needs readings at least 7 days old, so even
--                              7-day learning would stay silent until about day 14.
--
-- Measured on the three synthetic elders (tests/rafiqConfig.test.ts): Rafiq speaks
-- from day 8 instead of day 15–16; every real labelled event is still caught; no
-- day was flagged in the first 4 weeks either way. Real bands are noisier than
-- the synthetic ones: a normal built from 7 days is less sure of itself, so expect
-- more "watch" days (in-app only, never pushed) in weeks 2–4. Pushes stay limited
-- by everything else, unchanged: 3 days in a row for "alert", the 72-hour
-- cooldown, at most 2 Rafiq pushes per elder per day.
--
-- To go back: update public.rafiq_config set value = 14 where key = 'learning_min_days';
--             update public.rafiq_config set value = 7  where key = 'recent_days';
-- Safe to apply twice.

update public.rafiq_config set value = 7, updated_at = now() where key = 'learning_min_days' and value <> 7;
update public.rafiq_config set value = 2, updated_at = now() where key = 'recent_days' and value <> 2;

-- Check (read-only): both rows, the new values.
-- select key, value from public.rafiq_config where key in ('learning_min_days', 'recent_days');
