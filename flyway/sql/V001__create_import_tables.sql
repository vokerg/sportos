create extension if not exists pgcrypto;

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_kind text not null check (source_kind in ('xlsx', 'google_sheets', 'strava', 'garmin', 'fit', 'manual')),
  filename text,
  original_sha256 text,
  status text not null default 'started' check (status in ('started', 'parsed', 'normalized', 'scored', 'failed')),
  row_count integer not null default 0,
  normalized_count integer not null default 0,
  error_count integer not null default 0,
  warning_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table source_records (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references import_batches(id) on delete cascade,
  source text not null,
  sheet_name text,
  row_index integer,
  source_record_key text,
  row_hash text not null,
  raw_json jsonb not null,
  normalized_entity_type text,
  normalized_entity_id uuid,
  status text not null default 'raw' check (status in ('raw', 'normalized', 'skipped', 'error')),
  errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(import_batch_id, sheet_name, row_index)
);

create index idx_source_records_batch on source_records(import_batch_id);
create index idx_source_records_hash on source_records(row_hash);
create index idx_source_records_sheet on source_records(sheet_name);
