-- step30a live check — run AFTER applying 20261022090000_step30a_retire_llm_rafiq.sql
-- and BEFORE deleting the edge functions. Paste into the Supabase SQL editor.
--
-- READ-ONLY: it reads the catalog and calls one pure text function on an
-- in-memory alert row. It inserts nothing and sends no push.
-- Every line must say ok = true.

with
fn as (
  select p.proname, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
),
sample as (
  select public._alert_plain_texts(jsonb_populate_record(null::public.health_alerts, jsonb_build_object(
    'id', gen_random_uuid(), 'elder_id', gen_random_uuid(), 'kind', 'hr_high', 'severity', 'warning',
    'payload', jsonb_build_object('value', 118)))) as t
)
select 1 as n, 'the alert trigger no longer calls analyze-vitals' as check_name,
       not exists (select 1 from fn where prosrc ilike '%analyze-vitals%') as ok
union all
select 2, 'the alert trigger pushes non-emergency alerts directly',
       exists (select 1 from fn where proname = 'tg_health_alert_fanout' and prosrc like '%_notify_alert_plain%')
union all
select 3, 'emergencies still use the push-first path',
       exists (select 1 from fn where proname = 'tg_health_alert_fanout' and prosrc like '%_notify_emergency_first%')
union all
select 4, 'the trigger is attached to health_alerts',
       exists (select 1 from pg_trigger where tgname = 'trg_health_alert_fanout' and not tgisinternal and tgenabled <> 'D')
union all
select 5, 'fixed alert text works (English + Arabic)',
       (select t->'en'->>'body' like '%118 bpm%' and t->'ar'->>'title' is not null from sample)
union all
select 6, 'LLM-only functions are gone',
       not exists (select 1 from fn where proname in
         ('record_ai_assessment', 'recent_ai_assessments', 'resolve_contacts', 'recent_health_context'))
union all
select 7, 'old tables renamed to retired_*',
       to_regclass('public.ai_conversations') is null and to_regclass('public.ai_messages') is null
       and to_regclass('public.ai_health_assessments') is null
       and to_regclass('public.retired_ai_conversations') is not null
       and to_regclass('public.retired_ai_messages') is not null
       and to_regclass('public.retired_ai_health_assessments') is not null
union all
select 8, 'retired tables: RLS on, no policies',
       (select bool_and(c.relrowsecurity) and count(*) = 3 from pg_class c
         where c.relnamespace = 'public'::regnamespace and c.relname like 'retired_ai_%')
       and not exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'retired_ai_%')
union all
select 9, 'retired tables: no grants to anon / authenticated',
       not exists (select 1 from information_schema.role_table_grants
                    where table_schema = 'public' and table_name like 'retired_ai_%'
                      and grantee in ('anon', 'authenticated'))
union all
select 10, 'recent_health_alerts no longer reads AI assessments',
       exists (select 1 from fn where proname = 'recent_health_alerts' and prosrc not ilike '%ai_health_assessments%')
union all
select 11, 'export_account_data reads the retired tables',
       exists (select 1 from fn where proname = 'export_account_data'
                and prosrc like '%retired_ai_health_assessments%' and prosrc like '%retired_ai_conversations%')
order by 1;
