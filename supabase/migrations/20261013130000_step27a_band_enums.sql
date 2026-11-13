-- step27a — Salem Band: new enum values.
--
-- Kept in its own migration because Postgres won't let a new enum value be
-- USED in the same transaction that adds it; step27b uses these values.
--
--   • vital_source 'band'          — readings uploaded by band-ingest
--   • alert_kind 'band_off_wrist'  — band off the wrist > 2 h while awake (info)
--   • alert_kind 'band_no_data'    — no band data for 12 h (info)
--
-- Falls, SOS and low battery reuse the existing kinds 'fall_detected', 'sos'
-- and 'low_battery' (payload.source = 'band'), so every existing alert screen
-- and filter already understands them.

alter type public.vital_source add value if not exists 'band';
alter type public.alert_kind  add value if not exists 'band_off_wrist';
alter type public.alert_kind  add value if not exists 'band_no_data';
