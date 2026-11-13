-- step30d live check — run AFTER applying 20261022090300_step30d_rafiq_functions.sql.
-- Paste into the Supabase SQL editor. READ-ONLY (catalog only). Every row: ok = true.
with fn as (
  select p.proname, p.prosrc, p.prosecdef, p.oid
    from pg_proc p where p.pronamespace = 'public'::regnamespace
)
select 1 as n, 'all seven Rafiq functions exist' as check_name,
       (select count(distinct proname) from fn where proname in
         ('_rafiq_cfg','rafiq_raise','rafiq_resolve','acknowledge_rafiq_alert','rafiq_elders_due','rafiq_retention','rafiq_tick')) = 7 as ok
union all
select 2, 'they run with the owner''s rights (security definer)',
       (select bool_and(prosecdef) from fn where proname in
         ('_rafiq_cfg','rafiq_raise','rafiq_resolve','acknowledge_rafiq_alert','rafiq_elders_due','rafiq_retention','rafiq_tick'))
union all
select 3, 'the app can NOT call the server-only ones (raise, resolve, tick, elders, retention, cfg)',
       not exists (select 1 from fn where proname in
         ('_rafiq_cfg','rafiq_raise','rafiq_resolve','rafiq_elders_due','rafiq_retention','rafiq_tick')
         and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute')))
union all
select 4, 'signed-in users CAN mark a Rafiq alert as seen; not-signed-in users cannot',
       (select has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
          from fn where proname = 'acknowledge_rafiq_alert')
union all
select 5, 'acknowledging checks the read-health permission',
       exists (select 1 from fn where proname = 'acknowledge_rafiq_alert' and prosrc like '%has_perm(a.elder_id, ''health'')%')
union all
select 6, 'rafiq_raise: 72 h cooldown, daily limit, urgent bypass, watch in-app only, trend routing',
       exists (select 1 from fn where proname = 'rafiq_raise'
                and prosrc like '%notify_cooldown_hours'', 72%' and prosrc like '%max_notifications_per_day%'
                and prosrc like '%p_level = ''urgent''%' and prosrc like '%''in_app_only'', p_level = ''watch''%'
                and prosrc like '%''recipients'', ''trend''%')
union all
select 7, 'rafiq_raise never sends a location',
       exists (select 1 from fn where proname = 'rafiq_raise' and prosrc not ilike '%location%')
union all
select 8, 'nothing is scheduled yet (no cron job calls rafiq_tick)',
       not exists (select 1 from cron.job where command ilike '%rafiq_tick%')
union all
select 9, 'Trend Watch is still scheduled as before (until the schedule migration)',
       exists (select 1 from cron.job where jobname = 'salem_trend_watch_tick')
order by 1;
