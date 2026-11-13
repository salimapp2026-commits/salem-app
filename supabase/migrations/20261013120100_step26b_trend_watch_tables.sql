-- step26b — Trend Watch tables + row-level security + starting thresholds.
--
-- Read access everywhere is has_perm(elder_id, 'health'): the elder always
-- (has_perm returns true for yourself) and circle members with
-- can_read_health. No location data lives in any of these tables, so doctors
-- (who have read-health) see trends but still never location.
--
-- Nothing here is writable from the app. The trend-watch edge function writes
-- with the service role; doctors change a finding only through
-- mark_trend_expected() (step26c), which audits the action.

-- ------------------------------------------------------------- thresholds
create table if not exists public.trend_config (
  key         text primary key,
  value       numeric not null,
  description text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

comment on table public.trend_config is
  'Every Trend Watch threshold. Tuned by the medical advisor; the code reads this table on each run.';

alter table public.trend_config enable row level security;
-- Numbers only, no personal data: any signed-in user may read them (charts use them).
drop policy if exists trend_config_read on public.trend_config;
create policy trend_config_read on public.trend_config for select to authenticated using (true);

insert into public.trend_config (key, value, description) values
  ('baseline_window_days',        28,  'Baseline = this many days, ending before the recent window'),
  ('recent_window_days',           7,  'The most recent days, excluded from the baseline'),
  ('learning_min_days',           14,  'Days with enough readings before a metric can alert'),
  ('baseline_min_days',            7,  'Minimum enough-days inside the baseline window'),
  ('normal_band_mads',             2,  'Normal range = median ± this many robust SDs (1.4826 × MAD)'),
  ('min_readings_band',            6,  'Band: readings per day for HR / SpO2 / skin temperature to count'),
  ('min_readings_manual',          1,  'Manual: readings per day to count (BP, glucose, manual HR)'),
  ('activity_min_blocks',         60,  'Band: 10-minute step blocks per day (≈10 h worn) for activity to count'),
  ('night_min_blocks',            36,  'Band: 10-minute movement blocks per night (≈6 h) for restlessness to count'),
  ('night_start_hour',            22,  'Night window start (local time)'),
  ('night_end_hour',               6,  'Night window end (local time)'),
  ('hr_delta_bpm',                10,  'Resting HR: 7-day median at least this far above baseline'),
  ('hr_window_days',               7,  'Resting HR: rolling window length'),
  ('hr_window_min_days',           4,  'Resting HR: enough-days needed inside the rolling window'),
  ('hr_consecutive_days',          3,  'Resting HR: consecutive qualifying days → warning'),
  ('spo2_drop_points',             3,  'SpO2: daily median at least this many points below baseline'),
  ('spo2_days_required',           3,  'SpO2: low days needed …'),
  ('spo2_days_window',             5,  '… within the last this-many days → warning'),
  ('skin_temp_delta_c',          0.5,  'Skin temperature: daily mean at least this many °C above baseline'),
  ('skin_temp_consecutive_days',   2,  'Skin temperature: consecutive days → info (warning if resting HR is up on the same days)'),
  ('activity_info_drop_pct',      40,  'Activity: 7-day average this % below baseline → info'),
  ('activity_warning_drop_pct',   60,  'Activity: 7-day average this % below baseline → warning'),
  ('activity_min_days',            4,  'Activity: enough-days needed in the last 7'),
  ('night_rise_pct',              50,  'Night movement: this % above baseline …'),
  ('night_consecutive_days',       3,  '… for this many consecutive nights → info'),
  ('bp_systolic_delta',           15,  'Manual BP: 7-day average systolic this many mmHg above baseline average → warning'),
  ('bp_min_days',                  3,  'Manual BP: days with a reading needed in the last 7'),
  ('glucose_rise_pct',            20,  'Manual glucose: 7-day average this % above baseline average → info'),
  ('glucose_min_days',             3,  'Manual glucose: days with a reading needed in the last 7'),
  ('cooldown_hours',              72,  'Hours before the same metric may notify again'),
  ('resolve_days',                 3,  'Days inside the normal range before a finding auto-resolves'),
  ('expected_pause_days',         14,  '"Mark as expected" pauses the metric for this many days'),
  ('normal_floor_resting_hr',      4,  'Minimum half-width of the HR normal range (bpm)'),
  ('normal_floor_spo2',            1,  'Minimum half-width of the SpO2 normal range (points)'),
  ('normal_floor_skin_temp',     0.2,  'Minimum half-width of the skin-temperature normal range (°C)'),
  ('normal_floor_activity_pct',   15,  'Minimum half-width of the activity normal range (% of baseline)'),
  ('normal_floor_night_restlessness_pct', 20, 'Minimum half-width of the night-movement normal range (% of baseline)'),
  ('normal_floor_bp_systolic',     6,  'Minimum half-width of the BP normal range (mmHg)'),
  ('normal_floor_glucose_pct',     8,  'Minimum half-width of the glucose normal range (% of baseline)')
on conflict (key) do nothing;

-- ------------------------------------------------------------ daily summaries
create table if not exists public.vital_daily_summaries (
  elder_id    uuid not null references public.profiles(id) on delete cascade,
  metric      text not null check (metric in
                ('resting_hr','spo2','skin_temp','activity','night_restlessness','bp_systolic','glucose')),
  day         date not null,           -- in the elder's timezone
  value       numeric not null,        -- the metric's daily value (see refresh_vital_daily_summaries)
  median      numeric,
  mean        numeric,
  min         numeric,
  max         numeric,
  total       numeric,
  n           integer not null,        -- readings (or 10-minute blocks) that day
  from_band   boolean not null default false,
  enough      boolean not null,        -- met the minimum-readings rule
  computed_at timestamptz not null default now(),
  primary key (elder_id, metric, day)
);

-- ----------------------------------------------------------------- baselines
create table if not exists public.trend_baselines (
  elder_id      uuid not null references public.profiles(id) on delete cascade,
  metric        text not null,
  median        numeric,
  mean          numeric,
  mad           numeric,
  low           numeric,               -- normal range (charts + auto-resolve)
  high          numeric,
  valid_days    integer not null default 0,
  baseline_days integer not null default 0,
  learning      boolean not null default true,
  learning_day  integer not null default 0,
  reset_at      date,                  -- set by "mark as expected": baseline restarts here
  paused_until  date,                  -- set by "mark as expected": no alerts until after this
  computed_for  date,
  updated_at    timestamptz not null default now(),
  primary key (elder_id, metric)
);

-- ------------------------------------------------------------------ findings
create table if not exists public.trend_findings (
  id               uuid primary key default gen_random_uuid(),
  elder_id         uuid not null references public.profiles(id) on delete cascade,
  metric           text not null,
  -- Trend Watch NEVER raises critical. Enforced here as well as in code.
  severity         public.alert_severity not null check (severity in ('info','warning')),
  status           text not null default 'open' check (status in ('open','resolved','marked_expected')),
  baseline_value   numeric,
  current_value    numeric,
  change_value     numeric,
  change_unit      text check (change_unit in ('bpm','points','C','pct','mmHg')),
  days             integer not null,
  combined         boolean not null default false,  -- severity lifted because 2+ metrics changed
  explanation_en   text,
  explanation_ar   text,
  next_steps       text[] not null default '{}',     -- keys from the allowed list (trendText.ts)
  ai_used          boolean not null default false,
  template_reason  text,                             -- why AI text was replaced, if it was
  alert_id         uuid references public.health_alerts(id) on delete set null,
  opened_for       date not null,                    -- the day evaluated when it opened
  opened_at        timestamptz not null default now(),
  last_notified_at timestamptz,
  updated_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  expected_by      uuid references auth.users(id) on delete set null,
  expected_reason  text,
  expected_at      timestamptz
);

-- One open finding per elder per metric.
create unique index if not exists trend_findings_one_open
  on public.trend_findings (elder_id, metric) where status = 'open';
create index if not exists trend_findings_elder_recent
  on public.trend_findings (elder_id, opened_at desc);

-- ----------------------------------------------------------- weekly summaries
create table if not exists public.trend_weekly_summaries (
  id          uuid primary key default gen_random_uuid(),
  elder_id    uuid not null references public.profiles(id) on delete cascade,
  week_start  date not null,             -- Sunday-to-Saturday week that just ended
  metrics     jsonb not null,            -- per metric: this/last week, this/last month
  summary_en  text not null,
  summary_ar  text not null,
  ai_used     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (elder_id, week_start)
);

-- ------------------------------------------------------------------ run log
create table if not exists public.trend_runs (
  id          bigserial primary key,
  run_kind    text not null check (run_kind in ('daily','weekly','replay')),
  local_date  date not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  result      jsonb
);
create unique index if not exists trend_runs_once_per_day
  on public.trend_runs (run_kind, local_date) where run_kind <> 'replay';

-- ------------------------------------------------- elder opt-in for Home line
alter table public.profiles
  add column if not exists trend_line_enabled boolean not null default false;
comment on column public.profiles.trend_line_enabled is
  'Elder opted in to one gentle Trend Watch line on their Home screen. Off by default.';

-- ------------------------------------------------------------------- RLS
alter table public.vital_daily_summaries  enable row level security;
alter table public.trend_baselines        enable row level security;
alter table public.trend_findings         enable row level security;
alter table public.trend_weekly_summaries enable row level security;
alter table public.trend_runs             enable row level security;  -- no policies: service role only

drop policy if exists vds_select on public.vital_daily_summaries;
create policy vds_select on public.vital_daily_summaries
  for select to authenticated using (public.has_perm(elder_id, 'health'));

drop policy if exists tb_select on public.trend_baselines;
create policy tb_select on public.trend_baselines
  for select to authenticated using (public.has_perm(elder_id, 'health'));

drop policy if exists tf_select on public.trend_findings;
create policy tf_select on public.trend_findings
  for select to authenticated using (public.has_perm(elder_id, 'health'));

drop policy if exists tws_select on public.trend_weekly_summaries;
create policy tws_select on public.trend_weekly_summaries
  for select to authenticated using (public.has_perm(elder_id, 'health'));
