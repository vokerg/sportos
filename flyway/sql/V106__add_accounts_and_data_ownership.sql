-- Authentication and account ownership boundary for issue #14.
-- Flyway continues to run as the Neon schema owner. Runtime connections use
-- the non-superuser roles provisioned by Neon (or equivalent deployment-managed
-- role provisioning).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_data')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_worker')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_legacy') THEN
    RAISE EXCEPTION 'SportOS runtime roles are required before V106. Provision sportos_data, sportos_app, sportos_worker, and sportos_legacy.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION sportos_current_account_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('sportos.account_id', true), '')::uuid
$$;

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 200),
  email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  issuer text NOT NULL,
  subject text NOT NULL,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_hash char(64) NOT NULL CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash char(64),
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (absolute_expires_at >= expires_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX idx_auth_sessions_account ON auth_sessions (account_id, created_at DESC);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE auth_transactions (
  state_hash char(64) PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  code_verifier text NOT NULL CHECK (char_length(code_verifier) BETWEEN 43 AND 128),
  nonce text NOT NULL CHECK (char_length(nonce) BETWEEN 32 AND 200),
  return_to text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_transactions_expiry ON auth_transactions (expires_at);

-- Stable owner for data created before accounts existed.
INSERT INTO accounts (id, display_name, email, status)
VALUES ('00000000-0000-4000-8000-000000000001', 'Legacy local account', NULL, 'active')
ON CONFLICT (id) DO NOTHING;

DROP VIEW IF EXISTS v_score_breakdown;
DROP VIEW IF EXISTS v_daily_summary;
DROP VIEW IF EXISTS v_performance_events;

ALTER TABLE uploaded_files ADD COLUMN owner_id uuid;
ALTER TABLE import_batches ADD COLUMN owner_id uuid;
ALTER TABLE import_jobs ADD COLUMN owner_id uuid;
ALTER TABLE source_records ADD COLUMN owner_id uuid;
ALTER TABLE activities ADD COLUMN owner_id uuid;
ALTER TABLE daily_metrics ADD COLUMN owner_id uuid;
ALTER TABLE scoring_rules ADD COLUMN owner_id uuid;
ALTER TABLE scoring_rule_changes ADD COLUMN owner_id uuid;
ALTER TABLE score_ledger ADD COLUMN owner_id uuid;
ALTER TABLE performance_events ADD COLUMN owner_id uuid;

UPDATE uploaded_files SET owner_id = '00000000-0000-4000-8000-000000000001' WHERE owner_id IS NULL;
UPDATE import_batches SET owner_id = '00000000-0000-4000-8000-000000000001' WHERE owner_id IS NULL;
UPDATE import_jobs SET owner_id = '00000000-0000-4000-8000-000000000001' WHERE owner_id IS NULL;
UPDATE source_records SET owner_id = '00000000-0000-4000-8000-000000000001' WHERE owner_id IS NULL;
UPDATE activities SET owner_id = '00000000-0000-4000-8000-000000000001' WHERE owner_id IS NULL;
UPDATE daily_metrics SET owner_id = '00000000-0000-4000-8000-000000000001' WHERE owner_id IS NULL;
UPDATE scoring_rules SET owner_id = '00000000-0000-4000-8000-000000000001' WHERE owner_id IS NULL;
UPDATE scoring_rule_changes SET owner_id = '00000000-0000-4000-8000-000000000001' WHERE owner_id IS NULL;
UPDATE score_ledger SET owner_id = '00000000-0000-4000-8000-000000000001' WHERE owner_id IS NULL;
UPDATE performance_events SET owner_id = '00000000-0000-4000-8000-000000000001' WHERE owner_id IS NULL;

ALTER TABLE uploaded_files ALTER COLUMN owner_id SET DEFAULT sportos_current_account_id(), ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE import_batches ALTER COLUMN owner_id SET DEFAULT sportos_current_account_id(), ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE import_jobs ALTER COLUMN owner_id SET DEFAULT sportos_current_account_id(), ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE source_records ALTER COLUMN owner_id SET DEFAULT sportos_current_account_id(), ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE activities ALTER COLUMN owner_id SET DEFAULT sportos_current_account_id(), ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE daily_metrics ALTER COLUMN owner_id SET DEFAULT sportos_current_account_id(), ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE scoring_rules ALTER COLUMN owner_id SET DEFAULT sportos_current_account_id(), ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE scoring_rule_changes ALTER COLUMN owner_id SET DEFAULT sportos_current_account_id(), ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE score_ledger ALTER COLUMN owner_id SET DEFAULT sportos_current_account_id(), ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE performance_events ALTER COLUMN owner_id SET DEFAULT sportos_current_account_id(), ALTER COLUMN owner_id SET NOT NULL;

ALTER TABLE uploaded_files ADD CONSTRAINT uploaded_files_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE source_records ADD CONSTRAINT source_records_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE activities ADD CONSTRAINT activities_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE daily_metrics ADD CONSTRAINT daily_metrics_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE scoring_rules ADD CONSTRAINT scoring_rules_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE scoring_rule_changes ADD CONSTRAINT scoring_rule_changes_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE score_ledger ADD CONSTRAINT score_ledger_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE performance_events ADD CONSTRAINT performance_events_owner_fk FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE RESTRICT;

ALTER TABLE uploaded_files ADD CONSTRAINT uq_uploaded_files_owner_id UNIQUE (owner_id, id);
ALTER TABLE import_batches ADD CONSTRAINT uq_import_batches_owner_id UNIQUE (owner_id, id);
ALTER TABLE source_records ADD CONSTRAINT uq_source_records_owner_id UNIQUE (owner_id, id);
ALTER TABLE activities ADD CONSTRAINT uq_activities_owner_id UNIQUE (owner_id, id);
ALTER TABLE scoring_rules ADD CONSTRAINT uq_scoring_rules_owner_id UNIQUE (owner_id, id);

ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_uploaded_file_id_fkey;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_owner_upload_fk
  FOREIGN KEY (owner_id, uploaded_file_id) REFERENCES uploaded_files(owner_id, id)
  ON DELETE SET NULL (uploaded_file_id);

ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_uploaded_file_id_fkey;
ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_import_batch_id_fkey;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_owner_upload_fk
  FOREIGN KEY (owner_id, uploaded_file_id) REFERENCES uploaded_files(owner_id, id) ON DELETE RESTRICT;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_owner_batch_fk
  FOREIGN KEY (owner_id, import_batch_id) REFERENCES import_batches(owner_id, id)
  ON DELETE SET NULL (import_batch_id);

ALTER TABLE source_records DROP CONSTRAINT IF EXISTS source_records_import_batch_id_fkey;
ALTER TABLE source_records ADD CONSTRAINT source_records_owner_batch_fk
  FOREIGN KEY (owner_id, import_batch_id) REFERENCES import_batches(owner_id, id) ON DELETE CASCADE;

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_source_record_id_fkey;
ALTER TABLE activities ADD CONSTRAINT activities_owner_source_record_fk
  FOREIGN KEY (owner_id, source_record_id) REFERENCES source_records(owner_id, id)
  ON DELETE SET NULL (source_record_id);

ALTER TABLE daily_metrics DROP CONSTRAINT IF EXISTS daily_metrics_source_record_id_fkey;
ALTER TABLE daily_metrics ADD CONSTRAINT daily_metrics_owner_source_record_fk
  FOREIGN KEY (owner_id, source_record_id) REFERENCES source_records(owner_id, id)
  ON DELETE SET NULL (source_record_id);

ALTER TABLE score_ledger DROP CONSTRAINT IF EXISTS score_ledger_activity_id_fkey;
ALTER TABLE score_ledger DROP CONSTRAINT IF EXISTS score_ledger_rule_id_fkey;
ALTER TABLE score_ledger ADD CONSTRAINT score_ledger_owner_activity_fk
  FOREIGN KEY (owner_id, activity_id) REFERENCES activities(owner_id, id) ON DELETE CASCADE;
ALTER TABLE score_ledger ADD CONSTRAINT score_ledger_owner_rule_fk
  FOREIGN KEY (owner_id, rule_id) REFERENCES scoring_rules(owner_id, id)
  ON DELETE SET NULL (rule_id);

ALTER TABLE performance_events DROP CONSTRAINT IF EXISTS performance_events_activity_id_fkey;
ALTER TABLE performance_events DROP CONSTRAINT IF EXISTS performance_events_source_record_id_fkey;
ALTER TABLE performance_events ADD CONSTRAINT performance_events_owner_activity_fk
  FOREIGN KEY (owner_id, activity_id) REFERENCES activities(owner_id, id)
  ON DELETE SET NULL (activity_id);
ALTER TABLE performance_events ADD CONSTRAINT performance_events_owner_source_record_fk
  FOREIGN KEY (owner_id, source_record_id) REFERENCES source_records(owner_id, id)
  ON DELETE SET NULL (source_record_id);

ALTER TABLE scoring_rules DROP CONSTRAINT IF EXISTS scoring_rules_supersedes_rule_id_fkey;
ALTER TABLE scoring_rules ADD CONSTRAINT scoring_rules_owner_supersedes_fk
  FOREIGN KEY (owner_id, supersedes_rule_id) REFERENCES scoring_rules(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE scoring_rule_changes DROP CONSTRAINT IF EXISTS scoring_rule_changes_previous_rule_id_fkey;
ALTER TABLE scoring_rule_changes DROP CONSTRAINT IF EXISTS scoring_rule_changes_proposed_rule_id_fkey;
ALTER TABLE scoring_rule_changes ADD CONSTRAINT scoring_rule_changes_owner_previous_fk
  FOREIGN KEY (owner_id, previous_rule_id) REFERENCES scoring_rules(owner_id, id) ON DELETE RESTRICT;
ALTER TABLE scoring_rule_changes ADD CONSTRAINT scoring_rule_changes_owner_proposed_fk
  FOREIGN KEY (owner_id, proposed_rule_id) REFERENCES scoring_rules(owner_id, id) ON DELETE RESTRICT;

ALTER TABLE daily_metrics DROP CONSTRAINT IF EXISTS daily_metrics_pkey;
ALTER TABLE daily_metrics ADD CONSTRAINT daily_metrics_pkey PRIMARY KEY (owner_id, metric_date);

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_source_source_activity_id_key;
ALTER TABLE activities ADD CONSTRAINT uq_activities_owner_source_activity UNIQUE (owner_id, source, source_activity_id);

DROP INDEX IF EXISTS uq_source_records_batch_key_hash;
CREATE UNIQUE INDEX uq_source_records_owner_batch_key_hash
  ON source_records (owner_id, import_batch_id, source_record_key, row_hash);

DROP INDEX IF EXISTS uq_activities_source_identity;
CREATE UNIQUE INDEX uq_activities_owner_source_identity
  ON activities (owner_id, source, source_record_hash);

DROP INDEX IF EXISTS uq_performance_events_source_identity;
CREATE UNIQUE INDEX uq_performance_events_owner_source_identity
  ON performance_events (owner_id, source, source_record_hash);

DROP INDEX IF EXISTS uploaded_files_duplicate_lookup_idx;
CREATE INDEX uploaded_files_owner_duplicate_lookup_idx
  ON uploaded_files (owner_id, sha256, workbook_kind, created_at DESC)
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS uq_import_jobs_active_upload;
CREATE UNIQUE INDEX uq_import_jobs_owner_active_upload
  ON import_jobs (owner_id, uploaded_file_id)
  WHERE status IN ('queued', 'running');

ALTER TABLE scoring_rules DROP CONSTRAINT IF EXISTS uq_scoring_rules_code_version;
ALTER TABLE scoring_rules DROP CONSTRAINT IF EXISTS ex_scoring_rules_enabled_ranges;
ALTER TABLE scoring_rules ADD CONSTRAINT uq_scoring_rules_owner_code_version UNIQUE (owner_id, code, version);
ALTER TABLE scoring_rules ADD CONSTRAINT ex_scoring_rules_owner_enabled_ranges
  EXCLUDE USING gist (
    owner_id WITH =,
    code WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
  ) WHERE (enabled);

DROP INDEX IF EXISTS uq_scoring_rule_changes_active_code;
CREATE UNIQUE INDEX uq_scoring_rule_changes_owner_active_code
  ON scoring_rule_changes (owner_id, rule_code)
  WHERE status IN ('queued', 'running');

DROP INDEX IF EXISTS idx_scoring_rules_family;
CREATE INDEX idx_scoring_rules_owner_family ON scoring_rules (owner_id, code, version DESC);
CREATE INDEX idx_import_batches_owner_started ON import_batches (owner_id, started_at DESC, id DESC);
CREATE INDEX idx_import_jobs_owner_created ON import_jobs (owner_id, created_at DESC, id DESC);
CREATE INDEX idx_activities_owner_date ON activities (owner_id, activity_date, id);
CREATE INDEX idx_daily_metrics_owner_total ON daily_metrics (owner_id, total_points DESC);
CREATE INDEX idx_score_ledger_owner_date ON score_ledger (owner_id, metric_date, id);
CREATE INDEX idx_performance_owner_distance_date ON performance_events (owner_id, distance_m, event_date, id);

-- Account-scoped tables are always filtered for API/legacy roles. The dedicated
-- worker role is a trusted background-system exception and still writes explicit
-- owner values through the claimed job/change context.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'uploaded_files', 'import_batches', 'import_jobs', 'source_records',
    'activities', 'daily_metrics', 'scoring_rules', 'scoring_rule_changes',
    'score_ledger', 'performance_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY account_isolation ON %I TO sportos_app, sportos_legacy USING (owner_id = sportos_current_account_id()) WITH CHECK (owner_id = sportos_current_account_id())',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY worker_system_access ON %I TO sportos_worker USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END $$;

CREATE VIEW v_daily_summary WITH (security_invoker = true) AS
SELECT
  dm.metric_date,
  dm.steps,
  dm.run_m,
  dm.bike_m,
  dm.swim_m,
  dm.workout_points,
  dm.power_points,
  dm.base_points,
  dm.bonus_points,
  dm.total_points,
  dm.excel_all_points,
  CASE WHEN dm.excel_all_points IS NULL THEN NULL ELSE dm.total_points - dm.excel_all_points END AS points_delta_vs_excel,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS avg_10d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS avg_20d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS avg_30d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 59 PRECEDING AND CURRENT ROW) AS avg_60d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 364 PRECEDING AND CURRENT ROW) AS avg_365d
FROM daily_metrics dm;

CREATE VIEW v_score_breakdown WITH (security_invoker = true) AS
SELECT
  sl.metric_date,
  a.activity_type,
  a.subtype,
  sr.code AS rule_code,
  sr.name AS rule_name,
  sl.points,
  sl.reason,
  sl.calculation_json
FROM score_ledger sl
LEFT JOIN activities a ON a.owner_id = sl.owner_id AND a.id = sl.activity_id
LEFT JOIN scoring_rules sr ON sr.owner_id = sl.owner_id AND sr.id = sl.rule_id;

CREATE VIEW v_performance_events WITH (security_invoker = true) AS
SELECT
  pe.*,
  rank() OVER (PARTITION BY pe.owner_id, pe.distance_m ORDER BY pe.duration_s ASC, pe.event_date ASC) AS all_time_rank,
  min(pe.duration_s) OVER (
    PARTITION BY pe.owner_id, pe.distance_m
    ORDER BY pe.event_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) = pe.duration_s AS is_pr_by_time
FROM performance_events pe;

-- This function is the only cross-owner read exposed to the API role. It may only
-- seed the account currently selected in the transaction and never returns source data.
CREATE OR REPLACE FUNCTION sportos_seed_account_rules(target_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF target_account_id IS DISTINCT FROM sportos_current_account_id() THEN
    RAISE EXCEPTION 'target account does not match request context';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = target_account_id AND status = 'active') THEN
    RAISE EXCEPTION 'target account is not active';
  END IF;
  IF EXISTS (SELECT 1 FROM scoring_rules WHERE owner_id = target_account_id) THEN
    RETURN;
  END IF;

  INSERT INTO scoring_rules (
    owner_id, code, version, supersedes_rule_id, name, activity_type, rule_kind,
    metric, coefficient, threshold_operator, threshold_value, threshold_unit,
    points, valid_from, valid_to, priority, enabled, description, created_at
  )
  SELECT
    target_account_id, code, version, NULL, name, activity_type, rule_kind,
    metric, coefficient, threshold_operator, threshold_value, threshold_unit,
    points, valid_from, valid_to, priority, enabled, description, now()
  FROM scoring_rules
  WHERE owner_id = '00000000-0000-4000-8000-000000000001'
  ORDER BY code, version;
END;
$$;

REVOKE ALL ON FUNCTION sportos_seed_account_rules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sportos_seed_account_rules(uuid) TO sportos_app;

GRANT USAGE ON SCHEMA public TO sportos_data;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sportos_data;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sportos_data;
GRANT EXECUTE ON FUNCTION sportos_current_account_id() TO sportos_data;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sportos_data;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sportos_data;
