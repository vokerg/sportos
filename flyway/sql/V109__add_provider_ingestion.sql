-- Provider-neutral ingestion and first Strava adapter for issue #15.
-- Credentials are application-encrypted; database roles still enforce least privilege.

CREATE TABLE provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id()
    REFERENCES accounts(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('strava')),
  provider_account_id text NOT NULL CHECK (char_length(provider_account_id) BETWEEN 1 AND 200),
  display_name text CHECK (display_name IS NULL OR char_length(display_name) <= 200),
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'reauthorization_required', 'revoked', 'disconnected', 'error')),
  access_expires_at timestamptz,
  cursor_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT uq_provider_connections_owner_id UNIQUE (owner_id, id),
  CONSTRAINT uq_provider_connections_owner_provider UNIQUE (owner_id, provider),
  CONSTRAINT uq_provider_connections_provider_account UNIQUE (provider, provider_account_id)
);

CREATE INDEX idx_provider_connections_owner_updated
  ON provider_connections (owner_id, updated_at DESC, id DESC);

CREATE TABLE provider_credentials (
  connection_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id(),
  key_id text NOT NULL CHECK (char_length(key_id) BETWEEN 1 AND 100),
  algorithm text NOT NULL DEFAULT 'aes-256-gcm' CHECK (algorithm = 'aes-256-gcm'),
  nonce text NOT NULL CHECK (char_length(nonce) BETWEEN 16 AND 64),
  ciphertext text NOT NULL CHECK (char_length(ciphertext) BETWEEN 1 AND 20000),
  authentication_tag text NOT NULL CHECK (char_length(authentication_tag) BETWEEN 16 AND 64),
  envelope_version integer NOT NULL DEFAULT 1 CHECK (envelope_version = 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_credentials_owner_fk FOREIGN KEY (owner_id)
    REFERENCES accounts(id) ON DELETE RESTRICT,
  CONSTRAINT provider_credentials_owner_connection_fk FOREIGN KEY (owner_id, connection_id)
    REFERENCES provider_connections(owner_id, id) ON DELETE CASCADE,
  CONSTRAINT uq_provider_credentials_owner_id UNIQUE (owner_id, connection_id)
);

CREATE TABLE provider_oauth_transactions (
  state_hash char(64) PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id()
    REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('strava')),
  return_to text NOT NULL CHECK (char_length(return_to) BETWEEN 1 AND 1000),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_oauth_transactions_expiry
  ON provider_oauth_transactions (expires_at);

CREATE TABLE provider_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id(),
  connection_id uuid NOT NULL,
  import_batch_id uuid,
  mode text NOT NULL CHECK (mode IN ('initial_backfill', 'incremental', 'webhook_refresh')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  phase text NOT NULL DEFAULT 'queued',
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancellation_requested_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  requested_after timestamptz,
  requested_before timestamptz,
  cursor_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT provider_sync_jobs_owner_fk FOREIGN KEY (owner_id)
    REFERENCES accounts(id) ON DELETE RESTRICT,
  CONSTRAINT provider_sync_jobs_owner_connection_fk FOREIGN KEY (owner_id, connection_id)
    REFERENCES provider_connections(owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT provider_sync_jobs_owner_batch_fk FOREIGN KEY (owner_id, import_batch_id)
    REFERENCES import_batches(owner_id, id) ON DELETE SET NULL (import_batch_id),
  CONSTRAINT uq_provider_sync_jobs_owner_id UNIQUE (owner_id, id),
  CHECK (
    (status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR status <> 'running'
  ),
  CHECK (requested_before IS NULL OR requested_after IS NULL OR requested_before > requested_after)
);

CREATE UNIQUE INDEX uq_provider_sync_jobs_owner_active_connection
  ON provider_sync_jobs (owner_id, connection_id)
  WHERE status IN ('queued', 'running');
CREATE INDEX idx_provider_sync_jobs_claim
  ON provider_sync_jobs (next_attempt_at, created_at, id)
  WHERE status = 'queued';
CREATE INDEX idx_provider_sync_jobs_stale
  ON provider_sync_jobs (lease_expires_at)
  WHERE status = 'running';
CREATE INDEX idx_provider_sync_jobs_owner_created
  ON provider_sync_jobs (owner_id, created_at DESC, id DESC);

CREATE TABLE provider_activity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id(),
  connection_id uuid NOT NULL,
  provider_activity_id text NOT NULL CHECK (char_length(provider_activity_id) BETWEEN 1 AND 200),
  activity_id uuid NOT NULL,
  latest_source_record_id uuid NOT NULL,
  identity_fingerprint char(64) NOT NULL CHECK (identity_fingerprint ~ '^[0-9a-f]{64}$'),
  fingerprint_version integer NOT NULL DEFAULT 1 CHECK (fingerprint_version = 1),
  availability text NOT NULL DEFAULT 'available'
    CHECK (availability IN ('available', 'deleted', 'inaccessible')),
  provider_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_activity_links_owner_fk FOREIGN KEY (owner_id)
    REFERENCES accounts(id) ON DELETE RESTRICT,
  CONSTRAINT provider_activity_links_owner_connection_fk FOREIGN KEY (owner_id, connection_id)
    REFERENCES provider_connections(owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT provider_activity_links_owner_activity_fk FOREIGN KEY (owner_id, activity_id)
    REFERENCES activities(owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT provider_activity_links_owner_source_fk FOREIGN KEY (owner_id, latest_source_record_id)
    REFERENCES source_records(owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_provider_activity_links_owner_id UNIQUE (owner_id, id),
  CONSTRAINT uq_provider_activity_links_provider_activity
    UNIQUE (owner_id, connection_id, provider_activity_id)
);

CREATE INDEX idx_provider_activity_links_owner_activity
  ON provider_activity_links (owner_id, activity_id);

-- System inbox: not directly user-visible. owner_id remains nullable until an event
-- can be resolved to a connection without disclosing connection existence.
CREATE TABLE provider_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('strava')),
  event_key char(64) NOT NULL UNIQUE CHECK (event_key ~ '^[0-9a-f]{64}$'),
  provider_account_id text NOT NULL CHECK (char_length(provider_account_id) BETWEEN 1 AND 200),
  provider_object_id text,
  aspect text NOT NULL CHECK (aspect IN ('create', 'update', 'delete', 'deauthorize')),
  raw_json jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text
);
CREATE INDEX idx_provider_webhook_events_pending
  ON provider_webhook_events (received_at, id) WHERE processed_at IS NULL;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'provider_connections', 'provider_credentials', 'provider_oauth_transactions',
    'provider_sync_jobs', 'provider_activity_links'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

CREATE POLICY provider_connections_account_isolation ON provider_connections
  TO sportos_app, sportos_worker_data
  USING (owner_id = sportos_current_account_id())
  WITH CHECK (owner_id = sportos_current_account_id());
CREATE POLICY provider_credentials_account_isolation ON provider_credentials
  TO sportos_app, sportos_worker_data
  USING (owner_id = sportos_current_account_id())
  WITH CHECK (owner_id = sportos_current_account_id());
CREATE POLICY provider_oauth_transactions_account_isolation ON provider_oauth_transactions
  TO sportos_app
  USING (owner_id = sportos_current_account_id())
  WITH CHECK (owner_id = sportos_current_account_id());
CREATE POLICY provider_sync_jobs_account_isolation ON provider_sync_jobs
  TO sportos_app, sportos_worker_data
  USING (owner_id = sportos_current_account_id())
  WITH CHECK (owner_id = sportos_current_account_id());
CREATE POLICY provider_activity_links_account_isolation ON provider_activity_links
  TO sportos_app, sportos_worker_data
  USING (owner_id = sportos_current_account_id())
  WITH CHECK (owner_id = sportos_current_account_id());

CREATE POLICY provider_sync_dispatch_select ON provider_sync_jobs
  FOR SELECT TO sportos_worker USING (true);
CREATE POLICY provider_sync_dispatch_update ON provider_sync_jobs
  FOR UPDATE TO sportos_worker USING (true) WITH CHECK (true);

CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON provider_connections
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();
CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON provider_credentials
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();
CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON provider_oauth_transactions
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();
CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON provider_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();
CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON provider_activity_links
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();

-- Default/shared grants are intentionally removed first. Direct grants are applied
-- afterward so runtime capabilities are deterministic even when a login inherits
-- from sportos_data.
REVOKE ALL ON provider_connections, provider_credentials, provider_oauth_transactions,
  provider_sync_jobs, provider_activity_links, provider_webhook_events
  FROM sportos_data, sportos_legacy, sportos_worker, sportos_worker_data, sportos_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON provider_connections TO sportos_app, sportos_worker_data;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_credentials TO sportos_app, sportos_worker_data;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_oauth_transactions TO sportos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_sync_jobs TO sportos_app, sportos_worker_data;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_activity_links TO sportos_app, sportos_worker_data;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_webhook_events TO sportos_app;
GRANT SELECT, UPDATE ON provider_sync_jobs TO sportos_worker;

DO $$
BEGIN
  IF NOT has_table_privilege('sportos_worker_data', 'provider_connections', 'SELECT, UPDATE') THEN
    RAISE EXCEPTION 'sportos_worker_data must read and update provider_connections';
  END IF;
  IF NOT has_table_privilege('sportos_worker_data', 'provider_credentials', 'SELECT, UPDATE') THEN
    RAISE EXCEPTION 'sportos_worker_data must read and rotate provider_credentials';
  END IF;
  IF NOT has_table_privilege('sportos_worker_data', 'provider_sync_jobs', 'SELECT, INSERT, UPDATE') THEN
    RAISE EXCEPTION 'sportos_worker_data must operate owner-scoped provider_sync_jobs';
  END IF;
  IF NOT has_table_privilege('sportos_worker_data', 'provider_activity_links', 'SELECT, INSERT, UPDATE') THEN
    RAISE EXCEPTION 'sportos_worker_data must operate owner-scoped provider_activity_links';
  END IF;
  IF has_table_privilege('sportos_worker', 'provider_credentials', 'SELECT') THEN
    RAISE EXCEPTION 'sportos_worker dispatcher must not read provider_credentials';
  END IF;
  IF has_table_privilege('sportos_worker', 'provider_connections', 'SELECT') THEN
    RAISE EXCEPTION 'sportos_worker dispatcher must not read provider_connections';
  END IF;
END $$;
