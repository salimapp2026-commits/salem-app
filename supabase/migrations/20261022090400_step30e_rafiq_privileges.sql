-- step30e — Rafiq tables: remove the privileges Supabase grants by default.
--
-- Supabase's default privileges grant ALL on every new table in public to anon
-- and authenticated. step30c revoked everything from anon, and insert / update
-- / delete / truncate from authenticated, but not REFERENCES and TRIGGER (found
-- on salem-prod by check-step30c.sql, check 6). Neither lets an app user read
-- or change a row, but Rafiq's tables are meant to be read-only to the app, so
-- they go.
--
-- After this migration:
--   • anon           — no privilege on any rafiq_* table
--   • authenticated  — SELECT only, on rafiq_config / rafiq_baselines /
--                      rafiq_scores / rafiq_alerts (row-level security then
--                      limits rows to the elder and members with read-health);
--                      nothing on rafiq_runs
--   • service_role   — unchanged (the scorer writes through it)
-- Safe to run more than once. Changes no data.
--
-- Future rafiq_* tables must revoke the same way (default privileges are not
-- changed here: that would affect every other table in the project).

revoke all on table
  public.rafiq_config, public.rafiq_baselines, public.rafiq_scores, public.rafiq_alerts, public.rafiq_runs
  from anon;

revoke insert, update, delete, truncate, references, trigger on table
  public.rafiq_config, public.rafiq_baselines, public.rafiq_scores, public.rafiq_alerts, public.rafiq_runs
  from authenticated;

revoke all on table public.rafiq_runs from authenticated;

-- Reading stays exactly as step30c set it.
grant select on table
  public.rafiq_config, public.rafiq_baselines, public.rafiq_scores, public.rafiq_alerts
  to authenticated;
