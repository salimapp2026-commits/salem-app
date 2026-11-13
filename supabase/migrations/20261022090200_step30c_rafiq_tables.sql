-- step30c — Rafiq ML: tables, settings and row-level security.
--
-- Rafiq learns each elder's own normal from Salem Band data and flags what is
-- unusual for them (docs/RAFIQ_ML_PLAN.md). Scoring runs in the rafiq-score
-- edge function (service role); these tables hold its state and results.
--
-- Who sees what (row-level security, read-only for app users):
--   • the elder — their own rows
--   • a circle member with read-health (caregivers and linked doctors) — the
--     elder's rows, through the existing has_perm(elder, 'health')
--   • everyone else — nothing
-- There is deliberately NO location anywhere in these tables (no column, and
-- the scorer never puts one in the jsonb), so a doctor can never reach a
-- location through Rafiq. All writes are service-role only.

-- ------------------------------------------------------------------ settings
create table if not exists public.rafiq_config (
  key         text primary key,
  value       numeric not null,
  description text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
comment on table public.rafiq_config is
  'Every Rafiq setting. The scorer reads this table on each run, so a value can be tuned without a deploy.';

alter table public.rafiq_config enable row level security;
drop policy if exists rafiq_config_read on public.rafiq_config;
create policy rafiq_config_read on public.rafiq_config for select to authenticated using (true);

insert into public.rafiq_config (key, value, description) values
  -- when it runs (founder, 2026-10-22: daily only for the pilot, ~07:00 Cairo)
  ('scoring_daily_enabled',         1,  '1 = the daily pass runs'),
  ('scoring_hourly_enabled',        0,  '1 = also score "today so far" every hour (off for the pilot)'),
  ('daily_run_hour_cairo',          7,  'Local hour (Africa/Cairo) of the daily pass'),
  ('night_start_hour',             22,  'Night window start, elder''s local time'),
  ('night_end_hour',                7,  'Night window end, elder''s local time: the daily pass scores the previous day plus that night'),
  -- what it learns from
  ('baseline_days',                28,  'Baseline window length in days, ending before the recent window'),
  ('recent_days',                   7,  'The most recent days, kept out of the baseline'),
  ('learning_min_days',            14,  'Days with enough data before a metric can raise anything'),
  ('min_quality',                  60,  'Band HR / SpO2 readings below this quality are ignored (same as band_quality_min)'),
  ('min_readings_segment',          3,  'Resting HR / SpO2 readings a time-of-day segment needs to count'),
  ('min_wear_hours_day',            8,  'Hours worn for a day to count'),
  -- when it speaks
  ('watch_z',                       2,  'Deviation (robust SDs from their own normal) for "watch"'),
  ('alert_z',                       3,  'Deviation for "alert"'),
  ('watch_min_days',                2,  'Days in a row past watch_z before "watch"'),
  ('alert_min_days',                3,  'Days in a row past watch_z before "alert"'),
  ('use_model',                     1,  '1 = the trained model''s score also counts (thresholds come with the model file)'),
  -- urgent: only what the real-time band rules can't see (they already push falls, SOS, SpO2 < 88)
  ('urgent_night_spo2_median',     90,  'Night SpO2 median at or below this …'),
  ('urgent_night_hr_rise_bpm',     15,  '… together with night resting HR this far above their normal → urgent'),
  ('urgent_inactive_awake_hours',   6,  'Band worn, awake hours, no steps or movement for this long → urgent'),
  -- how often it speaks
  ('notify_cooldown_hours',        72,  'A reason that stays the same is not pushed again within this many hours (as Trend Watch); getting worse is pushed at once; urgent excepted'),
  ('max_notifications_per_day',     2,  'At most this many Rafiq pushes per elder per 24 h (urgent excepted)'),
  ('resolve_days',                  3,  'Normal days in a row before an open Rafiq alert resolves itself'),
  -- housekeeping
  ('intraday_retention_days',      90,  'Hourly scores are deleted after this many days; daily scores are kept')
on conflict (key) do nothing;

-- ------------------------------------------------------------------ baselines
-- One row per elder per metric (the model's metrics, ml/rafiq/core.py METRICS):
-- night / daytime resting heart rate, night oxygen median and its low readings,
-- night / daytime skin temperature, steps per worn daytime hour, night
-- movement, hours worn. "Usual range" low–high is what the charts shade.
create table if not exists public.rafiq_baselines (
  elder_id      uuid not null references public.profiles(id) on delete cascade,
  metric        text not null check (metric in
                  ('hr_night', 'hr_day', 'spo2_night', 'spo2_low', 'temp_night', 'temp_day',
                   'steps', 'move_night', 'wear')),
  median        numeric,
  robust_sd     numeric,                 -- 1.4826 × MAD, never below the metric's floor
  relative      boolean not null default false,  -- steps / movement: sd is a share of the median
  low           numeric,                 -- usual range shown on charts
  high          numeric,
  learning      boolean not null default true,
  computed_for  date,
  model_version text,
  updated_at    timestamptz not null default now(),
  primary key (elder_id, metric)
);
comment on table public.rafiq_baselines is
  'Each elder''s own normal per metric (Rafiq layer A), from days D-34..D-7. Written by rafiq-score.';

-- ------------------------------------------------------------------ scores
create table if not exists public.rafiq_scores (
  id             uuid primary key default gen_random_uuid(),
  elder_id       uuid not null references public.profiles(id) on delete cascade,
  scope          text not null check (scope in ('day', 'intraday')),
  scored_for     date not null,           -- the day evaluated, elder's local time
  window_start   timestamptz not null,
  window_end     timestamptz not null,
  level          public.rafiq_level not null,
  learning       boolean not null default false,
  model_score    numeric check (model_score is null or model_score between 0 and 1),
  model_version  text,
  features       jsonb not null default '{}',  -- model inputs (numbers only, never a location)
  deviations     jsonb not null default '{}',  -- per metric / segment: robust z and value vs. normal
  reasons        jsonb not null default '[]',  -- [{code, metrics, params, en, ar}]
  created_at     timestamptz not null default now(),
  unique (elder_id, scope, window_end)
);
create index if not exists rafiq_scores_elder_day on public.rafiq_scores (elder_id, scope, scored_for desc);
comment on table public.rafiq_scores is
  'Rafiq''s verdict per elder per day (and per hour when hourly scoring is on), with its reasons.';

-- ------------------------------------------------------------------ alerts
create table if not exists public.rafiq_alerts (
  id               uuid primary key default gen_random_uuid(),
  elder_id         uuid not null references public.profiles(id) on delete cascade,
  level            public.rafiq_level not null check (level <> 'normal'),
  reason_code      text not null,             -- e.g. resting_hr_up, spo2_night_down
  metrics          text[] not null default '{}',
  reason_params    jsonb not null default '{}',
  reason_en        text not null,             -- ends with the "not a diagnosis" line
  reason_ar        text not null,
  score_id         uuid references public.rafiq_scores(id) on delete set null,
  alert_id         uuid references public.health_alerts(id) on delete set null,
  status           text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  opened_for       date not null,
  opened_at        timestamptz not null default now(),
  days             integer not null default 1,
  last_notified_at timestamptz,
  notify_count     integer not null default 0,
  acknowledged_by  uuid references auth.users(id) on delete set null,
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  updated_at       timestamptz not null default now()
);
-- One live alert per reason per elder; it escalates or resolves in place.
create unique index if not exists rafiq_alerts_one_live
  on public.rafiq_alerts (elder_id, reason_code) where status in ('open', 'acknowledged');
create index if not exists rafiq_alerts_elder_recent on public.rafiq_alerts (elder_id, opened_at desc);
comment on table public.rafiq_alerts is
  'Rafiq alerts with their plain-language reason in English and Arabic. Watch = in-app only; alert and urgent are pushed.';

-- ------------------------------------------------------------------ runs
create table if not exists public.rafiq_runs (
  id            bigserial primary key,
  run_kind      text not null check (run_kind in ('daily', 'hourly', 'replay')),
  local_date    date not null,
  local_hour    integer not null default 0 check (local_hour between 0 and 23),
  model_version text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  result        jsonb
);
create unique index if not exists rafiq_runs_once
  on public.rafiq_runs (run_kind, local_date, local_hour) where run_kind <> 'replay';

-- ------------------------------------------------------------------ row-level security
alter table public.rafiq_baselines enable row level security;
alter table public.rafiq_scores    enable row level security;
alter table public.rafiq_alerts    enable row level security;
alter table public.rafiq_runs      enable row level security;   -- no policies: service role only

drop policy if exists rafiq_baselines_read on public.rafiq_baselines;
create policy rafiq_baselines_read on public.rafiq_baselines
  for select to authenticated using (public.has_perm(elder_id, 'health'));

drop policy if exists rafiq_scores_read on public.rafiq_scores;
create policy rafiq_scores_read on public.rafiq_scores
  for select to authenticated using (public.has_perm(elder_id, 'health'));

drop policy if exists rafiq_alerts_read on public.rafiq_alerts;
create policy rafiq_alerts_read on public.rafiq_alerts
  for select to authenticated using (public.has_perm(elder_id, 'health'));

-- Read-only for the app: no insert / update / delete grants or policies. An
-- acknowledgement goes through acknowledge_rafiq_alert() (step30d).
revoke all on public.rafiq_config, public.rafiq_baselines, public.rafiq_scores,
              public.rafiq_alerts, public.rafiq_runs from anon;
revoke insert, update, delete, truncate on public.rafiq_config, public.rafiq_baselines,
              public.rafiq_scores, public.rafiq_alerts, public.rafiq_runs from authenticated;
grant select on public.rafiq_config, public.rafiq_baselines, public.rafiq_scores, public.rafiq_alerts
  to authenticated;
revoke all on public.rafiq_runs from authenticated;
