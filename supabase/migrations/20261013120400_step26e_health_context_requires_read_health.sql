-- step26e — recent_health_context is server-only and permission-checked.
--
-- Before: SECURITY DEFINER, no permission check, EXECUTE granted to anon and
-- authenticated — anyone holding the app's public key could read any elder's
-- readings, alerts and medicines. No app screen calls it; only the ai-chat and
-- analyze-vitals edge functions do, with the service role.
--
-- After:
--   • EXECUTE only for service_role.
--   • Second guard inside: if a signed-in user ever reaches it, they must
--     have read-health for that elder (the elder always does for themselves).
--
-- Same signature and return shape, so the edge functions need no change to
-- keep working. See docs/HEALTH_CONTEXT_PERMISSION.md for every behaviour change.

create or replace function public.recent_health_context(p_elder_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.has_perm(p_elder_id, 'health') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'display_name', display_name,
        'date_of_birth', date_of_birth,
        'gender', gender,
        'preferred_locale', preferred_locale
      ) from public.profiles where id = p_elder_id
    ),
    'recent_vitals', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', kind,
        'value_numeric', value_numeric,
        'value_systolic', value_systolic,
        'value_diastolic', value_diastolic,
        'unit', unit,
        'captured_at', captured_at
      ) order by captured_at desc), '[]'::jsonb)
      from public.vitals
      where elder_id = p_elder_id
        and captured_at >= now() - interval '7 days'
      limit 100
    ),
    'recent_alerts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'kind', kind, 'severity', severity,
        'payload', payload, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb)
      from public.health_alerts
      where elder_id = p_elder_id
        and created_at >= now() - interval '7 days'
      limit 50
    ),
    'medications', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', name, 'dose', dose, 'notes', notes
      )), '[]'::jsonb)
      from public.medications
      where elder_id = p_elder_id and active = true
    )
  );
end;
$$;

revoke all on function public.recent_health_context(uuid) from public, anon, authenticated;
grant execute on function public.recent_health_context(uuid) to service_role;
