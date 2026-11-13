-- step30f live check — run AFTER applying 20261030090000_step30f_rafiq_schedule.sql.
-- Paste into the Supabase SQL editor. READ-ONLY (catalog + config, no secret
-- values are read). Every row: ok = true.
-- (check-step30d.sql rows 8 and 9 — "nothing is scheduled yet", "Trend Watch is
-- still scheduled" — are expected to be false from now on: that is this step.)
with j as (select jobname, schedule, command, coalesce(active, true) as active from cron.job)
select 1 as n, 'Rafiq is scheduled: salem_rafiq_tick, active, every hour at :15, calls rafiq_tick()' as check_name,
       exists (select 1 from j where jobname = 'salem_rafiq_tick' and active
                 and schedule = '15 * * * *' and command ilike '%public.rafiq_tick()%') as ok
union all
select 2, 'exactly one job calls rafiq_tick (no double morning pass)',
       (select count(*) from j where command ilike '%rafiq_tick%') = 1
union all
select 3, 'Trend Watch''s own job is gone (salem_trend_watch_tick)',
       not exists (select 1 from j where jobname = 'salem_trend_watch_tick')
union all
select 4, 'no job starts Trend Watch on its own (trend_watch_tick or the trend-watch function)',
       not exists (select 1 from j where command ilike '%trend_watch_tick%' or command ilike '%trend-watch%')
union all
select 5, 'the other 8 jobs are still there and active (band, reminders, retention, account deletion)',
       (select count(*) from j where active and jobname in (
          'salem_band_tick', 'salem_band_watchdog', 'salem_band_retention', 'salem_location_retention',
          'salem_dispatch_due_reminders', 'salem_materialize_reminder_events',
          'salem_expire_stale_reminder_events', 'finalize-account-deletions')) = 8
union all
select 6, 'daily pass on, at 07 Cairo; hourly "today so far" pass off',
       (select value from public.rafiq_config where key = 'scoring_daily_enabled') = 1
       and (select value from public.rafiq_config where key = 'daily_run_hour_cairo') = 7
       and (select value from public.rafiq_config where key = 'scoring_hourly_enabled') = 0
union all
select 7, 'the tick can reach rafiq-score: _post_edge exists and both Vault secrets are set (names only)',
       to_regprocedure('public._post_edge(text,jsonb)') is not null
       and (select count(*) from vault.secrets where name in ('salem_project_url', 'salem_service_role_key')) = 2
union all
select 8, 'the app can NOT start a pass: rafiq_tick is server-only',
       not has_function_privilege('anon', 'public.rafiq_tick(timestamptz)', 'execute')
       and not has_function_privilege('authenticated', 'public.rafiq_tick(timestamptz)', 'execute')
order by 1;

-- After the first morning (any day after 07:15 Cairo), this shows the run and
-- what Trend Watch and Rafiq did (read-only):
--   select local_date, started_at, finished_at, model_version,
--          jsonb_array_length(result->'rafiq') as elders_scored, result->'trend_watch' as trend_watch
--     from public.rafiq_runs where run_kind = 'daily' order by local_date desc limit 3;
