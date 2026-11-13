-- step27e — schedule the Salem Band jobs (pg_cron 1.6 supports seconds).
--
--   salem_band_fall_escalation  every 30 s   unanswered falls → critical alert
--                                            (so a fall alerts 30–60 s after it
--                                            reached the server, if nobody said
--                                            "I'm OK")
--   salem_band_watchdog         hourly :05   off wrist > 2 h / no data > 12 h
--                                            (only 08:00–22:00 elder-local)
--   salem_band_retention        daily 00:30 UTC (02:30/03:30 Cairo)
--                                            delete raw band rows > 90 days
--
-- Each job is a no-op when there are no bands. Existing jobs are not touched.

select cron.unschedule(jobid) from cron.job
 where jobname in ('salem_band_fall_escalation', 'salem_band_watchdog', 'salem_band_retention');

select cron.schedule('salem_band_fall_escalation', '30 seconds', $$ select public.band_escalate_falls(); $$);
select cron.schedule('salem_band_watchdog',        '5 * * * *',  $$ select public.band_watchdog(); $$);
select cron.schedule('salem_band_retention',       '30 0 * * *', $$ select public.band_purge_raw(); $$);
