create table activities (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('manual', 'my_sport_xlsx', 'run_db_xlsx', 'google_sheets', 'strava', 'garmin', 'fit')),
  source_record_id uuid references source_records(id) on delete set null,
  source_activity_id text,
  source_record_hash text,
  activity_date date not null,
  start_time timestamptz,
  activity_type text not null check (activity_type in ('steps', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'power_bonus')),
  subtype text check (subtype in ('outdoor', 'indoor', 'treadmill', 'manual', 'race', 'unknown')),
  distance_m numeric(12,2),
  duration_s integer,
  moving_time_s integer,
  steps integer,
  calories integer,
  avg_hr integer,
  max_hr integer,
  elevation_gain_m numeric(10,2),
  avg_speed_mps numeric(10,4),
  avg_pace_s_per_km numeric(10,2),
  effort_points integer,
  notes text,
  raw_payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source, source_activity_id)
);

create index idx_activities_date on activities(activity_date);
create index idx_activities_type_date on activities(activity_type, activity_date);
create index idx_activities_source_record on activities(source_record_id);

create table daily_metrics (
  metric_date date primary key,
  steps integer not null default 0,
  run_m numeric(12,2) not null default 0,
  bike_m numeric(12,2) not null default 0,
  swim_m numeric(12,2) not null default 0,
  workout_points integer not null default 0,
  power_points integer not null default 0,
  base_points integer not null default 0,
  bonus_points integer not null default 0,
  total_points integer not null default 0,
  excel_all_points numeric(14,2),
  excel_row_hash text,
  recomputed_at timestamptz not null default now()
);

create index idx_daily_metrics_total on daily_metrics(total_points desc);
