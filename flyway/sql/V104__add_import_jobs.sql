CREATE TABLE import_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_file_id uuid NOT NULL REFERENCES uploaded_files(id) ON DELETE RESTRICT,
    import_batch_id uuid REFERENCES import_batches(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    phase text NOT NULL DEFAULT 'queued',
    progress_percent integer NOT NULL DEFAULT 0
        CHECK (progress_percent BETWEEN 0 AND 100),
    attempt_count integer NOT NULL DEFAULT 0
        CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 3
        CHECK (max_attempts BETWEEN 1 AND 10),
    lease_owner text,
    lease_expires_at timestamptz,
    heartbeat_at timestamptz,
    cancellation_requested_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    error_code text,
    error_message text,
    result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    CHECK (
        (status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR status <> 'running'
    )
);

CREATE UNIQUE INDEX uq_import_jobs_active_upload
    ON import_jobs (uploaded_file_id)
    WHERE status IN ('queued', 'running');

CREATE INDEX idx_import_jobs_claim
    ON import_jobs (next_attempt_at, created_at, id)
    WHERE status = 'queued';

CREATE INDEX idx_import_jobs_stale_lease
    ON import_jobs (lease_expires_at)
    WHERE status = 'running';

CREATE INDEX idx_import_jobs_upload
    ON import_jobs (uploaded_file_id, created_at DESC);

CREATE INDEX idx_import_jobs_batch
    ON import_jobs (import_batch_id)
    WHERE import_batch_id IS NOT NULL;
