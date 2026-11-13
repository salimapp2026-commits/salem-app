-- step32n — the low-mood push's fallback fields are Arabic (founder, 2026-11-08). Safe
-- to apply twice. Needs step32l.
--
-- notify-fanout shows title_ar / body_ar only when a caller's `texts` lacks a language;
-- _notify_low_mood always sends both, so nothing on a phone changes today. But step32j
-- put the English text in those two fields, so a broken `texts` would show English on
-- an Arabic phone. They now carry the Arabic text, as their names say. The function
-- is step32l's with only those two lines changed.

create or replace function public._notify_low_mood()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_on   boolean := coalesce((select (value->>'low_mood_notify')::boolean
                                from public.app_config where key = 'rafiq_chat'), true);
  v_name text;
  v_en   text;
  v_ar   text;
begin
  -- The elder's own choice (Settings → "Tell my family when I answer Not good").
  v_on := v_on and coalesce((select p.mood_notify_family from public.profiles p where p.id = new.elder_id), true);
  if not v_on or new.mood <> 1 or new.low_notified_at is not null
     or (tg_op = 'UPDATE' and old.mood = 1)
     or new.day < current_date - 1 then
    return null;
  end if;
  -- Once a day: mark it first, so a second tap never sends again.
  update public.elder_moods set low_notified_at = now()
   where elder_id = new.elder_id and day = new.day and low_notified_at is null;
  if not found then
    return null;
  end if;

  select nullif(split_part(trim(coalesce(display_name, '')), ' ', 1), '') into v_name
    from public.profiles where id = new.elder_id;
  if v_name is null then
    v_en := 'Your family member answered "Not good" to today''s mood question. You may want to call and check in.';
    v_ar := 'الرد على سؤال المزاج النهارده: «مش بخير». ممكن تتصل تطمّن.';
  else
    v_en := v_name || ' answered "Not good" to today''s mood question. You may want to call and check in.';
    v_ar := 'رد ' || v_name || ' على سؤال المزاج النهارده: «مش بخير». ممكن تتصل تطمّن.';
  end if;

  begin
    perform public._post_edge('notify-fanout', jsonb_build_object(
      'elder_id', new.elder_id,
      'severity', 'warning',               -- primary caretaker + family with the health permission
      'source_kind', 'rafiq',
      'source_id', null,
      'title_ar', 'المزاج النهارده',     -- notify-fanout's fallback when texts is incomplete
      'body_ar', v_ar,
      'texts', jsonb_build_object(
        'en', jsonb_build_object('title', 'Mood today', 'body', v_en),
        'ar', jsonb_build_object('title', 'المزاج النهارده', 'body', v_ar)),
      'exclude_roles', jsonb_build_array('doctor'),
      'extra_data', jsonb_build_object('kind', 'low_mood'),
      'ttl_seconds', 43200));
  exception when others then
    raise warning 'salem: low-mood push failed for %: %', new.elder_id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public._notify_low_mood() from public, anon, authenticated;
