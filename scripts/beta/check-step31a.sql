-- step31a live check — run AFTER applying 20261031090000_step31a_health_connect.sql.
-- Paste into the Supabase SQL editor. READ-ONLY (catalog + counts). Every row: ok = true.
with trg as (
  select t.tgname, pg_get_triggerdef(t.oid) as def
    from pg_trigger t
   where t.tgrelid = 'public.vitals'::regclass and not t.tgisinternal
)
select 1 as n, 'one Health Connect row per elder, kind and moment (vitals_hc_dedupe)' as check_name,
       exists (select 1 from pg_indexes where indexname = 'vitals_hc_dedupe'
                 and indexdef ilike '%unique%(elder_id, kind, captured_at)%health_connect%') as ok
union all
select 2, 'Health Connect rows never raise a per-reading alert (trg_maybe_emit_vital_alert skips them)',
       exists (select 1 from trg where tgname = 'trg_maybe_emit_vital_alert'
                 and def ilike '%band%' and def ilike '%health_connect%')
union all
select 3, 'Health Connect rows skip the per-row audit, like band rows (audit_vitals, audit_vitals_delete)',
       (select count(*) from trg where tgname in ('audit_vitals', 'audit_vitals_delete')
          and def ilike '%band%' and def ilike '%health_connect%') = 2
union all
select 4, 'the app can only write Health Connect rows through hc_ingest (restrictive policies)',
       (select count(*) from pg_policy where polrelid = 'public.vitals'::regclass and not polpermissive
          and polname in ('vitals_no_client_hc_insert', 'vitals_no_client_hc_update')) = 2
union all
select 5, 'hc_ingest: security definer, signed-in users only (not anon)',
       (select prosecdef from pg_proc where oid = to_regprocedure('public.hc_ingest(jsonb)'))
       and has_function_privilege('authenticated', 'public.hc_ingest(jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.hc_ingest(jsonb)', 'execute')
union all
select 6, 'no alert has ever come from a Health Connect reading',
       not exists (select 1 from public.health_alerts a
                     join public.vitals v on v.id = (a.payload->>'vital_id')::bigint
                    where a.payload ? 'vital_id' and v.source = 'health_connect')
union all
select 7, 'Health Connect rows only from elders, for themselves',
       not exists (select 1 from public.vitals v left join public.profiles p on p.id = v.elder_id
                    where v.source = 'health_connect'
                      and (p.role is distinct from 'elder' or v.created_by is distinct from v.elder_id))
order by 1;

-- After a family's first sync: readings per elder and kind (no names, no values).
-- select elder_id, kind, count(*), min(captured_at), max(captured_at)
--   from public.vitals where source = 'health_connect' group by 1, 2 order by 1, 2;
