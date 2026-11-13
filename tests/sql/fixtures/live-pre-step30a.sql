-- The live project's objects that step30a changes, VERBATIM as they were before
-- step30a (read from the catalog of zslsukvrjafzfqybjsun with pg_get_functiondef
-- / pg_policies / role_table_grants on 2026-10-22). Used by the SQL tests as the
-- "before" state, so the rollback test proves the rollback recreates exactly
-- this. Do not edit to make a test pass — re-read the catalog instead.

-- ------------------------------------------------------------ policies + grants
create policy ai_conv_owner on public.ai_conversations as permissive for all to authenticated
  using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy ai_msg_owner on public.ai_messages as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM ai_conversations c
  WHERE ((c.id = ai_messages.conversation_id) AND (c.user_id = auth.uid())))))
  with check ((EXISTS ( SELECT 1
   FROM ai_conversations c
  WHERE ((c.id = ai_messages.conversation_id) AND (c.user_id = auth.uid())))));
create policy ai_assess_select on public.ai_health_assessments as permissive for select to public
  using (has_perm(elder_id, 'health'::text));
create policy ai_assess_insert_blocked on public.ai_health_assessments as permissive for insert to public
  with check (false);
grant all on public.ai_conversations, public.ai_messages, public.ai_health_assessments
  to anon, authenticated, service_role;

-- ------------------------------------------------------------ functions
CREATE OR REPLACE FUNCTION public.tg_health_alert_fanout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emergency boolean := NEW.kind in ('sos', 'fall_detected') and NEW.severity = 'critical';
begin
  -- Alerts that push themselves (band, Trend Watch) carry no_fanout.
  if (NEW.payload ? 'no_fanout') then
    return NEW;
  end if;

  -- 1. Emergencies: tell the family now, with fixed text. Never waits for AI.
  if v_emergency then
    begin
      perform public._notify_emergency_first(NEW);
    exception when others then
      raise warning 'salem: emergency push failed for alert %: %', NEW.id, sqlerrm;
    end;
  end if;

  -- 2. The AI assessment, afterwards. A failure here can't touch the alert.
  begin
    perform public._post_edge(
      'analyze-vitals',
      jsonb_build_object(
        'elder_id', NEW.elder_id,
        'alert_id', NEW.id,
        'source', 'health_alert_trigger',
        'already_notified', v_emergency
      )
    );
  exception when others then
    raise warning 'salem: analyze-vitals call failed for alert %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$function$;
revoke all on function public.tg_health_alert_fanout() from public, anon, authenticated;
grant execute on function public.tg_health_alert_fanout() to service_role;

CREATE OR REPLACE FUNCTION public.recent_health_alerts(p_limit integer DEFAULT 50, p_unacknowledged_only boolean DEFAULT false)
 RETURNS TABLE(id uuid, elder_id uuid, elder_name text, kind alert_kind, severity alert_severity, payload jsonb, acknowledged_by uuid, acknowledged_at timestamp with time zone, resolved_at timestamp with time zone, created_at timestamp with time zone, ai_explanation_ar text, ai_recommended_action text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    a.id,
    a.elder_id,
    p.display_name as elder_name,
    a.kind,
    a.severity,
    a.payload,
    a.acknowledged_by,
    a.acknowledged_at,
    a.resolved_at,
    a.created_at,
    asses.explanation_ar as ai_explanation_ar,
    asses.recommended_action as ai_recommended_action
  from public.health_alerts a
  left join public.profiles p on p.id = a.elder_id
  left join lateral (
    select explanation_ar, recommended_action
    from public.ai_health_assessments x
    where x.triggered_by_alert_id = a.id
    order by x.created_at desc
    limit 1
  ) asses on true
  where (not p_unacknowledged_only or a.acknowledged_at is null)
  order by a.created_at desc
  limit p_limit;
$function$;
grant execute on function public.recent_health_alerts(integer, boolean) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.export_account_data()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'circles_as_elder', (
      select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      from public.care_circles c where c.elder_id = auth.uid()
    ),
    'circle_memberships', (
      select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
      from public.care_circle_members m where m.user_id = auth.uid()
    ),
    'vitals', (
      select coalesce(jsonb_agg(to_jsonb(v) order by v.captured_at desc), '[]'::jsonb)
      from public.vitals v where v.elder_id = auth.uid()
    ),
    'health_alerts', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
      from public.health_alerts a where a.elder_id = auth.uid()
    ),
    'ai_assessments', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from public.ai_health_assessments x where x.elder_id = auth.uid()
    ),
    'reminders', (
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      from public.reminders r where r.elder_id = auth.uid()
    ),
    'medications', (
      select coalesce(jsonb_agg(to_jsonb(md)), '[]'::jsonb)
      from public.medications md where md.elder_id = auth.uid()
    ),
    'doctor_visits', (
      select coalesce(jsonb_agg(to_jsonb(dv) order by dv.visit_date desc), '[]'::jsonb)
      from public.doctor_visits dv where dv.elder_id = auth.uid()
    ),
    'ai_conversations', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'conversation', to_jsonb(ac),
          'messages', (
            select coalesce(jsonb_agg(to_jsonb(am) order by am.created_at), '[]'::jsonb)
            from public.ai_messages am where am.conversation_id = ac.id
          )
        )
      ), '[]'::jsonb)
      from public.ai_conversations ac where ac.user_id = auth.uid()
    ),
    'sent_messages', (
      select coalesce(jsonb_agg(to_jsonb(msg) order by msg.created_at desc), '[]'::jsonb)
      from public.messages msg where msg.sender_id = auth.uid()
    ),
    'notifications', (
      select coalesce(jsonb_agg(to_jsonb(n) order by n.sent_at desc), '[]'::jsonb)
      from public.notification_log n where n.recipient_user_id = auth.uid()
    )
  );
$function$;
grant execute on function public.export_account_data() to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_ai_assessment(p_elder_id uuid, p_alert_id uuid, p_severity alert_severity, p_explanation_ar text, p_recommended_action text, p_context jsonb, p_model text, p_tokens integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_id uuid;
begin
  insert into public.ai_health_assessments (
    elder_id, triggered_by_alert_id, severity,
    explanation_ar, recommended_action, context_summary,
    model_used, tokens_used
  ) values (
    p_elder_id, p_alert_id, p_severity,
    p_explanation_ar, p_recommended_action, coalesce(p_context, '{}'::jsonb),
    p_model, p_tokens
  ) returning id into new_id;
  return new_id;
end
$function$;
grant execute on function public.record_ai_assessment(uuid, uuid, alert_severity, text, text, jsonb, text, integer)
  to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recent_ai_assessments(p_elder_id uuid, p_limit integer DEFAULT 20)
 RETURNS SETOF ai_health_assessments
 LANGUAGE sql
 STABLE
AS $function$
  select *
  from public.ai_health_assessments
  where elder_id = p_elder_id
    and public.has_perm(p_elder_id, 'health')
  order by created_at desc
  limit p_limit;
$function$;
grant execute on function public.recent_ai_assessments(uuid, integer) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_contacts(p_elder_id uuid, p_query text DEFAULT NULL::text)
 RETURNS TABLE(source text, contact_user_id uuid, name text, relationship text, phone_e164 text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with q as (select nullif(trim(coalesce(p_query, '')), '') as term)
  -- Emergency contacts
  select
    'emergency'::text as source,
    null::uuid as contact_user_id,
    ec.name,
    ec.relation as relationship,
    ec.phone_e164
  from public.emergency_contacts ec, q
  where ec.elder_id = p_elder_id
    and (q.term is null
         or ec.name ilike '%' || q.term || '%'
         or coalesce(ec.relation,'') ilike '%' || q.term || '%')
  union all
  -- Circle members (active), excluding the elder themselves
  select
    'circle'::text as source,
    m.user_id as contact_user_id,
    p.display_name as name,
    m.relationship,
    p.phone_e164
  from public.care_circle_members m
  join public.care_circles c on c.id = m.circle_id
  join public.profiles p on p.id = m.user_id
  , q
  where c.elder_id = p_elder_id
    and m.status = 'active'
    and m.user_id <> p_elder_id
    and (q.term is null
         or p.display_name ilike '%' || q.term || '%'
         or coalesce(m.relationship,'') ilike '%' || q.term || '%');
$function$;
grant execute on function public.resolve_contacts(uuid, text) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recent_health_context(p_elder_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
revoke all on function public.recent_health_context(uuid) from public, anon, authenticated;
grant execute on function public.recent_health_context(uuid) to service_role;

create trigger trg_health_alert_fanout after insert on public.health_alerts
  for each row execute function public.tg_health_alert_fanout();
