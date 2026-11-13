-- step27f — pin search_path on _band_when (security advisor: role-mutable
-- search_path). Behaviour unchanged; it only formats text.
alter function public._band_when(timestamptz, boolean, text, text) set search_path = public;
