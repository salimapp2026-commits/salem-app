-- step30e live check — run AFTER applying 20261022090400_step30e_rafiq_privileges.sql.
-- Paste into the Supabase SQL editor. READ-ONLY (catalog only). Every row: ok = true.
-- (check-step30c.sql should then also be 12/12.)
with g as (
  select table_name, grantee, privilege_type from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('rafiq_config', 'rafiq_baselines', 'rafiq_scores', 'rafiq_alerts', 'rafiq_runs')
)
select 1 as n, 'not-signed-in users (anon): no privilege at all on Rafiq tables' as check_name,
       not exists (select 1 from g where grantee = 'anon') as ok
union all
select 2, 'signed-in users: no REFERENCES, TRIGGER or TRUNCATE on any Rafiq table',
       not exists (select 1 from g where grantee = 'authenticated' and privilege_type in ('REFERENCES', 'TRIGGER', 'TRUNCATE'))
union all
select 3, 'signed-in users: no INSERT, UPDATE or DELETE on any Rafiq table',
       not exists (select 1 from g where grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))
union all
select 4, 'signed-in users: SELECT on config, baselines, scores and alerts — and only that',
       (select count(*) from g where grantee = 'authenticated') = 4
       and (select count(*) from g where grantee = 'authenticated' and privilege_type = 'SELECT'
              and table_name in ('rafiq_config', 'rafiq_baselines', 'rafiq_scores', 'rafiq_alerts')) = 4
union all
select 5, 'signed-in users: nothing on rafiq_runs',
       not exists (select 1 from g where grantee = 'authenticated' and table_name = 'rafiq_runs')
union all
select 6, 'the scorer (service_role) can still read and write every Rafiq table',
       (select count(distinct table_name) from g where grantee = 'service_role' and privilege_type = 'INSERT') = 5
order by 1;
