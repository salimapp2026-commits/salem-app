-- step26a — Trend Watch: new enum values and the vitals "resting" flag.
--
-- Kept in its own migration because Postgres won't let a new enum value be
-- USED in the same transaction that adds it; 26b/26c use these values.
--
--   • alert_kind 'trend'        — health_alerts rows raised by Trend Watch
--   • vital_kind 'glucose'      — manual blood-sugar readings
--   • vital_kind 'skin_temperature'
--                               — band skin temperature. Kept separate from
--                                 'temperature' (manual body temperature) so the
--                                 two are never mixed in one baseline.
--   • vital_kind 'active_minutes'
--   • vital_kind 'movement'     — movement count per 10-minute band block;
--                                 night restlessness is derived from it.
--   • vitals.is_resting         — set by the band; NULL for manual readings.
--
-- vitals.source already exists (manual / healthkit / health_connect / watch /
-- ai_inferred). Part B adds 'band'.

alter type public.alert_kind add value if not exists 'trend';

alter type public.vital_kind add value if not exists 'glucose';
alter type public.vital_kind add value if not exists 'skin_temperature';
alter type public.vital_kind add value if not exists 'active_minutes';
alter type public.vital_kind add value if not exists 'movement';

alter table public.vitals add column if not exists is_resting boolean;

comment on column public.vitals.is_resting is
  'True when the wearer was still for this reading (band only). NULL = unknown (manual). '
  'Trend Watch uses only resting heart-rate and SpO2 readings when this is set.';
