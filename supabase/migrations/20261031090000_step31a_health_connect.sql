-- step31a — Health Connect readings (Android beta).
--
-- The elder's phone reads what their band's app (Mi Fitness, Samsung Health,
-- Zepp, Fitbit…) writes to Health Connect and sends it here with hc_ingest().
-- Rows land in public.vitals with source = 'health_connect', in the shape
-- Rafiq reads (native/src/lib/hcRows.ts): heart rate and oxygen samples with
-- is_resting/quality, steps per 10-minute block. rafiq-score reads them for an
-- elder with no Salem Band readings.
--
--   1. No duplicates: one row per elder, kind and moment. A re-sync of the same
--      hours updates the row (a band app may fill an hour in late).
--   2. Never an alert per reading: health_connect rows skip the per-row vital
--      check (maybe_emit_vital_alert: hr_high / hr_low / spo2_low at warning or
--      critical) and the per-row audit, exactly like band rows. A heart rate of
--      140 on a walk must not page the family. SOS and falls only ever come
--      from the SOS button and Salem Band events — never from these rows.
--   3. The app cannot write health_connect rows directly, only through
--      hc_ingest(), which checks the caller is the elder and every value.
--
-- Changes no existing row. Safe to apply twice.
-- Check with scripts/beta/check-step31a.sql.
--
-- To undo:
--   drop function if exists public.hc_ingest(jsonb);
--   drop policy if exists vitals_no_client_hc_insert on public.vitals;
--   drop policy if exists vitals_no_client_hc_update on public.vitals;
--   drop index if exists public.vitals_hc_dedupe;
--   (and re-create the three triggers with WHEN (… is distinct from 'band') only)
--   delete from public.vitals where source = 'health_connect';   -- only if wanted

-- ------------------------------------------------------------------ 1. dedupe
create unique index if not exists vitals_hc_dedupe
  on public.vitals (elder_id, kind, captured_at) where source = 'health_connect';

-- ------------------------------------------------------------------ 2. no per-row alert or audit
drop trigger if exists trg_maybe_emit_vital_alert on public.vitals;
create trigger trg_maybe_emit_vital_alert
  after insert on public.vitals
  for each row when (new.source is distinct from 'band' and new.source is distinct from 'health_connect')
  execute function public.maybe_emit_vital_alert();

drop trigger if exists audit_vitals on public.vitals;
create trigger audit_vitals
  after insert or update on public.vitals
  for each row when (new.source is distinct from 'band' and new.source is distinct from 'health_connect')
  execute function public.tg_audit_write();

drop trigger if exists audit_vitals_delete on public.vitals;
create trigger audit_vitals_delete
  after delete on public.vitals
  for each row when (old.source is distinct from 'band' and old.source is distinct from 'health_connect')
  execute function public.tg_audit_write();

-- ------------------------------------------------------------------ 3. only through hc_ingest
drop policy if exists vitals_no_client_hc_insert on public.vitals;
create policy vitals_no_client_hc_insert on public.vitals
  as restrictive for insert to authenticated, anon
  with check (source is distinct from 'health_connect');

drop policy if exists vitals_no_client_hc_update on public.vitals;
create policy vitals_no_client_hc_update on public.vitals
  as restrictive for update to authenticated, anon
  using (source is distinct from 'health_connect')
  with check (source is distinct from 'health_connect');

-- p_rows: [{ "k": "heart_rate"|"spo2"|"steps", "t": ISO time, "v": number,
--            "r": resting (bool), "q": quality 0–100 }]
-- Rows out of range, older than 31 days or in the future are skipped (counted).
create or replace function public.hc_ingest(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elder   uuid := auth.uid();
  v_n       int;
  v_valid   int;
  v_written int;
begin
  if v_elder is null or not exists (select 1 from public.profiles p where p.id = v_elder and p.role = 'elder') then
    raise exception 'hc_ingest: only the elder''s own phone sends Health Connect readings' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'hc_ingest: p_rows must be an array' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 5000 then
    raise exception 'hc_ingest: at most 5000 rows per call (got %)', v_n using errcode = '22023';
  end if;

  with src as (
    select distinct on (x->>'k', (x->>'t')::timestamptz)
           x->>'k' as k, (x->>'t')::timestamptz as t, (x->>'v')::numeric as v,
           coalesce((x->>'r')::boolean, false) as r, (x->>'q')::smallint as q
      from jsonb_array_elements(p_rows) x
     where (x->>'t')::timestamptz between now() - interval '31 days' and now() + interval '5 minutes'
       and (   (x->>'k' = 'heart_rate' and (x->>'v')::numeric between 25 and 250)
            or (x->>'k' = 'spo2'       and (x->>'v')::numeric between 50 and 100)
            or (x->>'k' = 'steps'      and (x->>'v')::numeric between 0 and 5000))
       and ((x->>'q') is null or (x->>'q')::numeric between 0 and 100)
     order by x->>'k', (x->>'t')::timestamptz
  ), w as (
    insert into public.vitals (elder_id, kind, value_numeric, unit, source, captured_at, created_by, is_resting, quality)
    select v_elder, src.k::public.vital_kind, src.v,
           case src.k when 'heart_rate' then 'bpm' when 'spo2' then '%' else 'steps' end,
           'health_connect', src.t, v_elder, src.r, src.q
      from src
    on conflict (elder_id, kind, captured_at) where source = 'health_connect'
    do update set value_numeric = excluded.value_numeric,
                  is_resting    = excluded.is_resting,
                  quality       = excluded.quality
     where (vitals.value_numeric, vitals.is_resting, vitals.quality)
           is distinct from (excluded.value_numeric, excluded.is_resting, excluded.quality)
    returning 1
  )
  select (select count(*) from src), (select count(*) from w) into v_valid, v_written;

  return jsonb_build_object('received', v_n, 'skipped', v_n - v_valid, 'written', v_written);
end;
$$;

comment on function public.hc_ingest(jsonb) is
  'Health Connect readings from the elder''s own phone (step31a). Deduped, range-checked, never alerts per row.';

revoke all on function public.hc_ingest(jsonb) from public, anon;
grant execute on function public.hc_ingest(jsonb) to authenticated, service_role;
