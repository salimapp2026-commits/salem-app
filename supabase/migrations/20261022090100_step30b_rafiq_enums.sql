-- step30b — Rafiq ML: enum values. Kept in their own migration because a new
-- enum value can't be used in the same transaction that adds it.
--
--   • rafiq_level  normal / watch / alert / urgent — Rafiq's verdict for a day
--   • alert_kind 'rafiq' — the health_alerts row raised for a Rafiq alert or
--     urgent (it carries payload.no_fanout: Rafiq pushes it itself, like the
--     band and Trend Watch do)

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rafiq_level' and typnamespace = 'public'::regnamespace) then
    create type public.rafiq_level as enum ('normal', 'watch', 'alert', 'urgent');
  end if;
end;
$$;

alter type public.alert_kind add value if not exists 'rafiq';
