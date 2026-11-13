-- step32g — two push fixes found in the first real reminder test (2026-11-01).
-- Safe to apply twice.
--
-- 1. The push log refused every reminder push. notification_log.source_kind only
--    allowed health_alert / sos / ai_assessment / system / trend, so the log row for
--    'reminder' (step32e), 'reminder_missed' (step32f) and Rafiq's own alerts
--    ('rafiq', step30d) failed — silently, notify-fanout doesn't check it. Allowed now.
--
-- 2. A phone receives pushes for ONE account only: the last one that signed in on it.
--
-- Found 2026-11-01 on the emulator: after signing out of a caregiver account and into
-- the elder, push_tokens held the SAME OneSignal subscription for both. Every push for
-- the caregiver (SOS, missed doses, other elders' alerts) would also have arrived on
-- the elder's phone — and, on a family phone handed down to an elder, another
-- person's alerts on the wrong phone.
--
-- Now: when a subscription is saved for a user, the same subscription is removed from
-- every other user (trigger). The app also removes its own row on sign-out.
-- Existing duplicates: only the most recently seen owner is kept.

-- ── 1. Push log kinds ───────────────────────────────────────────────────────
alter table public.notification_log drop constraint if exists notification_log_source_kind_check;
alter table public.notification_log add constraint notification_log_source_kind_check
  check (source_kind = any (array['health_alert', 'sos', 'ai_assessment', 'system', 'trend',
                                  'rafiq', 'reminder', 'reminder_missed']));

-- ── 2. One account per phone ────────────────────────────────────────────────
create or replace function public._push_token_one_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.onesignal_player_id is not null then
    delete from public.push_tokens
     where onesignal_player_id = new.onesignal_player_id
       and user_id <> new.user_id;
  end if;
  if new.token is not null then
    delete from public.push_tokens
     where token = new.token
       and user_id <> new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function public._push_token_one_owner() from public, anon, authenticated;

drop trigger if exists push_tokens_one_owner on public.push_tokens;
create trigger push_tokens_one_owner
  after insert or update of onesignal_player_id, token, user_id on public.push_tokens
  for each row execute function public._push_token_one_owner();

-- Existing duplicates: keep the most recently seen owner of each subscription.
delete from public.push_tokens t
 using public.push_tokens n
 where t.onesignal_player_id is not null
   and n.onesignal_player_id = t.onesignal_player_id
   and n.user_id <> t.user_id
   and (n.last_seen_at > t.last_seen_at or (n.last_seen_at = t.last_seen_at and n.id > t.id));

-- Check (read-only): both must return 0.
-- select count(*) from public.notification_log where source_kind not in
--   ('health_alert','sos','ai_assessment','system','trend','rafiq','reminder','reminder_missed');
-- select count(*) from (select onesignal_player_id from public.push_tokens
--   where onesignal_player_id is not null group by 1 having count(distinct user_id) > 1) d;
