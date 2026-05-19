create table performance_events (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references activities(id) on delete set null,
  source_record_id uuid references source_records(id) on delete set null,
  source text not null check (source in ('manual', 'run_db_xlsx', 'strava', 'garmin', 'fit')),
  event_date date not null,
  distance_m numeric(12,2) not null,
  duration_s integer not null,
  pace_s_per_km numeric(10,2) not null,
  is_treadmill boolean not null default false,
  is_race boolean not null default false,
  is_pr_marker boolean not null default false,
  source_rank integer,
  tags text[] not null default '{}',
  notes text,
  raw_payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_performance_distance_date on performance_events(distance_m, event_date);
create index idx_performance_pace on performance_events(distance_m, duration_s);
