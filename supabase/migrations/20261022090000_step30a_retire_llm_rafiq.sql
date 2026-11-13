-- step30a — retire the LLM Rafiq. Alerts no longer wait for (or depend on) an
-- AI assessment; the old Rafiq tables are kept but locked.
--
-- Self-contained: apply this BEFORE deleting the ai-chat / analyze-vitals /
-- transcribe-audio / tts edge functions and revoking GEMINI_API_1 /
-- OPENAI_API_KEY (docs/RAFIQ_ML_PLAN.md §7, checklist in docs/RAFIQ.md).
--
-- 1. tg_health_alert_fanout no longer calls analyze-vitals.
--    analyze-vitals used to be the ONLY push for every alert that doesn't carry
--    payload.no_fanout: manual heart-rate / oxygen alerts, band warnings, band
--    criticals confirmed by a second reading, and anything else inserted into
--    health_alerts without its own push. It pushed after Gemini answered.
--    Those alerts now go straight to notify-fanout with fixed English + Arabic
--    text (_notify_alert_plain), with the alert's own severity, so the family
--    is told at once and nothing depends on an outside AI.
--    Emergencies (critical SOS / fall) keep step28a's push-first path
--    unchanged; the AI follow-up update that came after it is simply gone.
--    Alerts that push themselves (band, Trend Watch, Rafiq) still carry
--    no_fanout and are untouched.
--
-- 2. recent_health_alerts keeps its exact signature (the app reads it), but
--    ai_explanation_ar / ai_recommended_action are now always NULL. App
--    versions that still read them keep working.
--
-- 3. export_account_data still exports each person's own old Rafiq chats and
--    assessments (their data), now from the retired tables. Same JSON keys.
--
-- 4. The functions that only served the LLM Rafiq are dropped (none holds
--    data): record_ai_assessment (also closes the "callable with the public
--    key" gap in docs/HEALTH_CONTEXT_PERMISSION.md), recent_ai_assessments,
--    resolve_contacts, recent_health_context.
--
-- 5. ai_conversations, ai_messages, ai_health_assessments are RENAMED to
--    retired_* and locked: their policies are dropped and every app-role grant
--    is revoked; row level security stays on with no policy, so anon and
--    authenticated see nothing. NOTHING IS DROPPED — the rows stay until the
--    founder decides. Account deletion still removes a person's rows (the
--    foreign keys and their ON DELETE rules are unchanged by a rename).

-- ------------------------------------------------------------------ 1. fixed-text push
-- {title, body} in English and Arabic for an alert, from its kind, severity and
-- payload. No numbers that aren't in the payload, no diagnosis, no location.
create or replace function public._alert_plain_texts(p_alert public.health_alerts)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_name   text;
  v_value  numeric := case when (p_alert.payload->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
                           then (p_alert.payload->>'value')::numeric end;
  v_num    text;
  v_band   boolean := p_alert.payload->>'source' = 'band';
  v_crit   boolean := p_alert.severity = 'critical';
  v_t_en text; v_b_en text; v_t_ar text; v_b_ar text;
  v_end_en text;
  v_end_ar text;
begin
  select coalesce(nullif(split_part(trim(coalesce(display_name, '')), ' ', 1), ''), 'Your family member')
    into v_name from public.profiles where id = p_alert.elder_id;
  v_name := coalesce(v_name, 'Your family member');
  v_num  := case when v_value is null then null
                 else trim(to_char(v_value, 'FM999990.0')) end;
  v_num  := regexp_replace(coalesce(v_num, ''), '\.0$', '');

  v_end_en := case when v_crit then ' Call them now.'
                   else ' Check on them, and contact the doctor if you are worried.' end;
  -- Arabic wording avoids gendered verbs and pronouns for the elder.
  v_end_ar := case when v_crit then ' اتصل الآن.'
                   else ' اطمئن على ' || v_name || '، وتواصل مع الطبيب إذا كنت قلقًا.' end;

  case p_alert.kind
    when 'hr_high' then
      v_t_en := 'High heart rate: ' || v_name;
      v_t_ar := 'نبض مرتفع: ' || v_name;
      v_b_en := case when v_num <> '' then v_name || '''s heart rate was ' || v_num || ' bpm'
                     else v_name || '''s heart rate was high' end;
      v_b_ar := case when v_num <> '' then 'سُجّل نبض ' || v_name || ' ' || v_num || ' نبضة في الدقيقة'
                     else 'سُجّل نبض مرتفع لـ' || v_name end;
    when 'hr_low' then
      v_t_en := 'Low heart rate: ' || v_name;
      v_t_ar := 'نبض منخفض: ' || v_name;
      v_b_en := case when v_num <> '' then v_name || '''s heart rate was ' || v_num || ' bpm'
                     else v_name || '''s heart rate was low' end;
      v_b_ar := case when v_num <> '' then 'سُجّل نبض ' || v_name || ' ' || v_num || ' نبضة في الدقيقة'
                     else 'سُجّل نبض منخفض لـ' || v_name end;
    when 'spo2_low' then
      v_t_en := 'Low oxygen: ' || v_name;
      v_t_ar := 'أكسجين منخفض: ' || v_name;
      v_b_en := case when v_num <> '' then v_name || '''s oxygen level was ' || v_num || '%'
                     else v_name || '''s oxygen level was low' end;
      v_b_ar := case when v_num <> '' then 'سُجّلت نسبة أكسجين ' || v_name || ' ' || v_num || '٪'
                     else 'سُجّلت نسبة أكسجين منخفضة لـ' || v_name end;
    when 'zone_exit' then
      v_t_en := v_name || ' left a safe zone';
      v_t_ar := v_name || ' خارج المنطقة الآمنة';
      v_b_en := 'Open Salem to see the details';
      v_b_ar := 'افتح سليم لرؤية التفاصيل';
    when 'no_movement' then
      v_t_en := 'No movement: ' || v_name;
      v_t_ar := 'لا توجد حركة: ' || v_name;
      v_b_en := 'Salem has not seen movement from ' || v_name || ' for a while';
      v_b_ar := 'لم يرصد سليم أي حركة لـ' || v_name || ' منذ فترة';
    when 'med_missed' then
      v_t_en := 'Missed medicine: ' || v_name;
      v_t_ar := 'دواء لم يُؤكَّد: ' || v_name;
      v_b_en := v_name || ' has not confirmed a medicine reminder';
      v_b_ar := 'لم يُؤكَّد تذكير دواء ' || v_name;
    when 'low_battery' then
      v_t_en := 'Low battery: ' || v_name;
      v_t_ar := 'بطارية منخفضة: ' || v_name;
      v_b_en := v_name || '''s device battery is low';
      v_b_ar := 'بطارية جهاز ' || v_name || ' منخفضة';
    when 'sos' then
      v_t_en := 'SOS from ' || v_name;
      v_t_ar := 'استغاثة من ' || v_name;
      v_b_en := v_name || ' asked for help in the Salem app';
      v_b_ar := 'نداء مساعدة من ' || v_name || ' في تطبيق سليم';
    when 'fall_detected' then
      v_t_en := 'Possible fall: ' || v_name;
      v_t_ar := 'احتمال سقوط: ' || v_name;
      v_b_en := 'Salem detected a possible fall';
      v_b_ar := 'رصد سليم احتمال سقوط';
    else
      v_t_en := 'Salem update for ' || v_name;
      v_t_ar := 'تحديث من سليم بخصوص ' || v_name;
      v_b_en := 'Open Salem to see the details';
      v_b_ar := 'افتح سليم لرؤية التفاصيل';
  end case;

  if v_band and p_alert.kind in ('hr_high', 'hr_low', 'spo2_low') then
    v_b_en := v_b_en || ' (Salem Band'
              || case when (p_alert.payload->>'confirmed') = 'true' then ', confirmed by a second reading' else '' end
              || ')';
    v_b_ar := v_b_ar || ' (سوار سليم'
              || case when (p_alert.payload->>'confirmed') = 'true' then '، وتأكدت بقراءة ثانية' else '' end
              || ')';
  end if;

  v_b_en := v_b_en || '.' || v_end_en;
  v_b_ar := v_b_ar || '.' || v_end_ar;

  return jsonb_build_object(
    'en', jsonb_build_object('title', v_t_en, 'body', v_b_en),
    'ar', jsonb_build_object('title', v_t_ar, 'body', v_b_ar));
end;
$$;

-- The push for every alert that doesn't push itself and isn't an emergency.
-- Replaces analyze-vitals' notify-fanout call; same recipients rule
-- (get_alert_recipients by the alert's own severity), same source kind as the
-- emergency path so a tap opens the alert.
create or replace function public._notify_alert_plain(p_alert public.health_alerts)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_texts jsonb := public._alert_plain_texts(p_alert);
begin
  perform public._post_edge('notify-fanout', jsonb_build_object(
    'elder_id', p_alert.elder_id,
    'severity', p_alert.severity,
    'source_kind', 'health_alert',
    'source_id', p_alert.id,
    'title_ar', v_texts->'en'->>'title',
    'body_ar', v_texts->'en'->>'body',
    'texts', v_texts));
end;
$$;

revoke all on function public._alert_plain_texts(public.health_alerts) from public, anon, authenticated;
revoke all on function public._notify_alert_plain(public.health_alerts) from public, anon, authenticated;

create or replace function public.tg_health_alert_fanout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emergency boolean := NEW.kind in ('sos', 'fall_detected') and NEW.severity = 'critical';
begin
  -- Alerts that push themselves (band, Trend Watch, Rafiq) carry no_fanout.
  if (NEW.payload ? 'no_fanout') then
    return NEW;
  end if;

  -- Wrapped: a pg_net error can never roll back or delay the alert row.
  begin
    if v_emergency then
      -- Unchanged since step28a: fixed text, last known location for the
      -- people allowed to see it, never doctors.
      perform public._notify_emergency_first(NEW);
    else
      perform public._notify_alert_plain(NEW);
    end if;
  exception when others then
    raise warning 'salem: alert push failed for alert %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$$;

-- ------------------------------------------------------------------ 2. recent_health_alerts
create or replace function public.recent_health_alerts(
  p_limit integer default 50,
  p_unacknowledged_only boolean default false)
returns table (
  id uuid, elder_id uuid, elder_name text, kind public.alert_kind, severity public.alert_severity,
  payload jsonb, acknowledged_by uuid, acknowledged_at timestamptz, resolved_at timestamptz,
  created_at timestamptz, ai_explanation_ar text, ai_recommended_action text)
language sql
stable
set search_path = public
as $$
  -- ai_explanation_ar / ai_recommended_action are kept only so older app
  -- versions don't break; there is no AI assessment any more (step30a).
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
    null::text as ai_explanation_ar,
    null::text as ai_recommended_action
  from public.health_alerts a
  left join public.profiles p on p.id = a.elder_id
  where (not p_unacknowledged_only or a.acknowledged_at is null)
  order by a.created_at desc
  limit p_limit;
$$;

-- ------------------------------------------------------------------ 4. drop LLM-only functions
drop function if exists public.record_ai_assessment(uuid, uuid, public.alert_severity, text, text, jsonb, text, integer);
drop function if exists public.recent_ai_assessments(uuid, integer);
drop function if exists public.resolve_contacts(uuid, text);
drop function if exists public.recent_health_context(uuid);

-- ------------------------------------------------------------------ 5. retire + lock the tables
do $$
begin
  if to_regclass('public.ai_conversations') is not null and to_regclass('public.retired_ai_conversations') is null then
    alter table public.ai_conversations rename to retired_ai_conversations;
  end if;
  if to_regclass('public.ai_messages') is not null and to_regclass('public.retired_ai_messages') is null then
    alter table public.ai_messages rename to retired_ai_messages;
  end if;
  if to_regclass('public.ai_health_assessments') is not null and to_regclass('public.retired_ai_health_assessments') is null then
    alter table public.ai_health_assessments rename to retired_ai_health_assessments;
  end if;
end;
$$;

drop policy if exists ai_conv_owner            on public.retired_ai_conversations;
drop policy if exists ai_msg_owner             on public.retired_ai_messages;
drop policy if exists ai_assess_select         on public.retired_ai_health_assessments;
drop policy if exists ai_assess_insert_blocked on public.retired_ai_health_assessments;

-- RLS on with no policy = nothing for anon / authenticated; and no grants either.
alter table public.retired_ai_conversations      enable row level security;
alter table public.retired_ai_messages           enable row level security;
alter table public.retired_ai_health_assessments enable row level security;
revoke all on table public.retired_ai_conversations      from anon, authenticated;
revoke all on table public.retired_ai_messages           from anon, authenticated;
revoke all on table public.retired_ai_health_assessments from anon, authenticated;

comment on table public.retired_ai_conversations is
  'Retired 2026-10-22 (step30a): the old LLM Rafiq chat. Locked, kept until the founder decides; exported by export_account_data.';
comment on table public.retired_ai_messages is
  'Retired 2026-10-22 (step30a): messages of the old LLM Rafiq chat. Locked, kept until the founder decides; exported by export_account_data.';
comment on table public.retired_ai_health_assessments is
  'Retired 2026-10-22 (step30a): Gemini assessments of alerts. Locked, kept until the founder decides; exported by export_account_data.';

-- ------------------------------------------------------------------ 3. export_account_data
create or replace function public.export_account_data()
returns jsonb
language sql
stable security definer
set search_path = public
as $$
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
    -- The old Rafiq's assessments and chats are still this person's data.
    'ai_assessments', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from public.retired_ai_health_assessments x where x.elder_id = auth.uid()
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
            from public.retired_ai_messages am where am.conversation_id = ac.id
          )
        )
      ), '[]'::jsonb)
      from public.retired_ai_conversations ac where ac.user_id = auth.uid()
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
$$;
