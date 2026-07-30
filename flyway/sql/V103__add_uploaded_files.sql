create table uploaded_files (
  id uuid primary key,
  workbook_kind text not null check (workbook_kind in ('my_sport', 'run_db')),
  storage_provider text not null check (storage_provider in ('local')),
  object_key text not null unique,
  original_filename text not null,
  sanitized_filename text not null,
  content_type text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 20971520),
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('stored', 'imported', 'failed', 'deleted')),
  last_error text,
  created_at timestamptz not null default now(),
  imported_at timestamptz,
  deleted_at timestamptz,
  constraint uploaded_files_deleted_state_check check (
    (status = 'deleted' and deleted_at is not null)
    or (status <> 'deleted' and deleted_at is null)
  )
);

create index uploaded_files_duplicate_lookup_idx
  on uploaded_files (sha256, workbook_kind, created_at desc)
  where deleted_at is null;

alter table import_batches
  add column uploaded_file_id uuid references uploaded_files(id) on delete set null;

create index import_batches_uploaded_file_id_idx
  on import_batches (uploaded_file_id)
  where uploaded_file_id is not null;
