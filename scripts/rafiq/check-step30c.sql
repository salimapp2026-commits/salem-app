-- step30c live check — run AFTER applying 20261022090200_step30c_rafiq_tables.sql.
-- Paste into the Supabase SQL editor. READ-ONLY: catalog + the settings table
-- (no person's data). Every row: ok = true.
with cfg as (select key, value from public.rafiq_config)
select 1 as n, 'the five Rafiq tables exist' as check_name,
       (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
         and c.relname in ('rafiq_config','rafiq_baselines','rafiq_scores','rafiq_alerts','rafiq_runs')) = 5 as ok
union all
select 2, 'row-level security is on for all five',
       (select bool_and(c.relrowsecurity) from pg_class c where c.relnamespace = 'public'::regnamespace
         and c.relname in ('rafiq_config','rafiq_baselines','rafiq_scores','rafiq_alerts','rafiq_runs'))
union all
select 3, 'baselines, scores, alerts: readable only through has_perm(elder, health)',
       (select count(*) from pg_policies where schemaname = 'public'
         and tablename in ('rafiq_baselines','rafiq_scores','rafiq_alerts')
         and cmd = 'SELECT' and qual ilike '%has_perm(elder_id, ''health''%') = 3
       and not exists (select 1 from pg_policies where schemaname = 'public'
         and tablename in ('rafiq_baselines','rafiq_scores','rafiq_alerts') and cmd <> 'SELECT')
union all
select 4, 'rafiq_runs has no policy (server only)',
       not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rafiq_runs')
union all
select 5, 'not-signed-in users have no access to any Rafiq table',
       not exists (select 1 from information_schema.role_table_grants
                    where table_schema = 'public' and table_name like 'rafiq\_%' and grantee = 'anon')
union all
select 6, 'signed-in users can only read (never write) Rafiq tables, and never rafiq_runs',
       not exists (select 1 from information_schema.role_table_grants
                    where table_schema = 'public' and table_name like 'rafiq\_%' and grantee = 'authenticated'
                      and (privilege_type <> 'SELECT' or table_name = 'rafiq_runs'))
union all
select 7, 'no Rafiq column can hold a location',
       not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name like 'rafiq\_%'
                      and column_name ~* '(^|_)(lat|lon|lng|latitude|longitude|location|geog|geom|address|place|coords?)($|_)')
union all
select 8, 'daily scoring on, at 07:00 Cairo; hourly scoring off',
       (select value from cfg where key = 'scoring_daily_enabled') = 1
       and (select value from cfg where key = 'daily_run_hour_cairo') = 7
       and (select value from cfg where key = 'scoring_hourly_enabled') = 0
union all
select 9, 'notify_cooldown_hours = 72 (a reason that stays the same is not pushed again for 72 h)',
       (select value from cfg where key = 'notify_cooldown_hours') = 72
union all
select 10, 'at most 2 Rafiq pushes per elder per day',
       (select value from cfg where key = 'max_notifications_per_day') = 2
union all
select 11, 'rafiq_baselines stores the model''s nine metrics',
       exists (select 1 from pg_constraint where conrelid = 'public.rafiq_baselines'::regclass and contype = 'c'
                and pg_get_constraintdef(oid) ilike all (array['%hr_night%','%spo2_low%','%temp_day%','%move_night%','%wear%']))
union all
select 12, 'the step30a checks still hold (alert trigger has no AI call)',
       not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%analyze-vitals%')
order by 1;
