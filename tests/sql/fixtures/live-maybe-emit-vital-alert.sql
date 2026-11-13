-- public.maybe_emit_vital_alert() exactly as live on salem-prod (read from the catalog 2026-10-31).
CREATE OR REPLACE FUNCTION public.maybe_emit_vital_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_kind alert_kind;
  v_severity alert_severity;
  v_payload jsonb := jsonb_build_object('vital_id', NEW.id, 'kind', NEW.kind::text);
begin
  if NEW.kind = 'heart_rate' and NEW.value_numeric is not null then
    if NEW.value_numeric < 45 then
      v_kind := 'hr_low'; v_severity := 'critical';
    elsif NEW.value_numeric < 50 then
      v_kind := 'hr_low'; v_severity := 'warning';
    elsif NEW.value_numeric > 130 then
      v_kind := 'hr_high'; v_severity := 'critical';
    elsif NEW.value_numeric > 110 then
      v_kind := 'hr_high'; v_severity := 'warning';
    end if;
  elsif NEW.kind = 'spo2' and NEW.value_numeric is not null then
    if NEW.value_numeric < 88 then
      v_kind := 'spo2_low'; v_severity := 'critical';
    elsif NEW.value_numeric < 92 then
      v_kind := 'spo2_low'; v_severity := 'warning';
    end if;
  end if;

  if v_kind is not null then
    insert into public.health_alerts (elder_id, kind, severity, payload)
    values (NEW.elder_id, v_kind, v_severity, v_payload || jsonb_build_object('value', NEW.value_numeric));
  end if;

  return NEW;
end;
$function$;
