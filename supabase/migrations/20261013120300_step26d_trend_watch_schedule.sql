-- step26d — schedule Trend Watch.
--
-- Hourly, on the hour. trend_watch_tick() (step26c) only acts when it is 06:00
-- in Cairo and hasn't already run today, so daylight-saving changes are
-- handled and a duplicate tick is harmless. Sundays also produce the weekly
-- summary.
--
-- Applied after the trend-watch edge function was deployed, so the first
-- tick can never call a function that doesn't exist yet. The existing jobs
-- (reminders, account deletion) are not touched.

select cron.unschedule(jobid) from cron.job where jobname = 'salem_trend_watch_tick';

select cron.schedule(
  'salem_trend_watch_tick',
  '0 * * * *',
  $$ select public.trend_watch_tick(); $$
);
