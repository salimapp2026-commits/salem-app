-- step30f — schedule Rafiq; Trend Watch now runs inside it.
--
-- After this migration ONE job runs the morning pass:
--   salem_rafiq_tick, every hour at :15. rafiq_tick() (step30d) only acts in
--   the Cairo hour daily_run_hour_cairo (07 → 07:15 Cairo) and only once a day
--   (rafiq_runs), so Egypt's summer-time changes are handled and a duplicate
--   tick is harmless. It posts { mode: 'daily' } to rafiq-score, which runs
--   1. Trend Watch — its rules, thresholds, cooldown and Sunday weekly summary,
--      unchanged (_shared/trendWatchRun.ts), then
--   2. Rafiq for every elder with recent band data.
--   :15, not :00, gives bands that sync just after 07:00 time to upload the
--   end of the night.
--
-- salem_trend_watch_tick (step26d, 06:00 Cairo → the trend-watch function) is
-- removed, so Trend Watch never runs twice. The trend-watch function itself
-- stays deployed (replays use it). trend_watch_tick() stays defined but unused.
--
-- The hourly "today so far" pass stays OFF (rafiq_config scoring_hourly_enabled
-- = 0). Nothing else is touched: band, reminder, retention and account jobs
-- keep their schedules.
--
-- Apply only after rafiq-score is deployed (it is: v2) — the first tick calls it.
-- Safe to apply twice. Check with scripts/rafiq/check-step30f.sql.
--
-- To undo (back to Trend Watch alone at 06:00, Rafiq not running):
--   select cron.unschedule(jobid) from cron.job where jobname = 'salem_rafiq_tick';
--   select cron.schedule('salem_trend_watch_tick', '0 * * * *', $$ select public.trend_watch_tick(); $$);

do $$
begin
  if to_regprocedure('public.rafiq_tick(timestamptz)') is null then
    raise exception 'step30f: public.rafiq_tick does not exist — apply step30d first';
  end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname in ('salem_trend_watch_tick', 'salem_rafiq_tick');

select cron.schedule(
  'salem_rafiq_tick',
  '15 * * * *',
  $$ select public.rafiq_tick(); $$
);
