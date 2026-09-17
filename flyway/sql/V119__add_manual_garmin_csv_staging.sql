-- Manual Garmin CSV imports retain raw source rows and maintain an overlap-safe
-- staging projection. They deliberately do not write canonical activities,
-- daily metrics, score ledgers, or score snapshots.

ALTER TABLE uploaded_files
  DROP CONSTRAINT uploaded_files_workbook_kind_check;

ALTER TABLE uploaded_files
  ADD CONSTRAINT uploaded_files_workbook_kind_check
  CHECK (workbook_kind IN ('my_sport', 'run_db', 'garmin_csv'));

CREATE TABLE garmin_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id()
    REFERENCES accounts(id) ON DELETE RESTRICT,
  report_type text NOT NULL CHECK (report_type IN (
    'steps_weekly',
    'calories_weekly',
    'floors_weekly',
    'weight_body_composition'
  )),
  identity_key text NOT NULL CHECK (length(identity_key) BETWEEN 1 AND 200),
  recorded_date date NOT NULL,
  recorded_time time without time zone,
  values_json jsonb NOT NULL,
  value_hash char(64) NOT NULL CHECK (value_hash ~ '^[0-9a-f]{64}$'),
  current_source_record_id uuid NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_garmin_observations_owner_id UNIQUE (owner_id, id),
  CONSTRAINT uq_garmin_observations_identity UNIQUE (owner_id, report_type, identity_key),
  CONSTRAINT garmin_observations_owner_source_record_fk
    FOREIGN KEY (owner_id, current_source_record_id)
    REFERENCES source_records(owner_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_garmin_observations_owner_date
  ON garmin_observations (owner_id, recorded_date, report_type, id);

ALTER TABLE garmin_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE garmin_observations FORCE ROW LEVEL SECURITY;

CREATE POLICY account_isolation ON garmin_observations
  TO sportos_app, sportos_legacy, sportos_worker_data
  USING (owner_id = sportos_current_account_id())
  WITH CHECK (owner_id = sportos_current_account_id());

CREATE TRIGGER reject_owner_change
  BEFORE UPDATE OF owner_id ON garmin_observations
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();

REVOKE ALL ON garmin_observations
  FROM sportos_data, sportos_legacy, sportos_worker, sportos_worker_data, sportos_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON garmin_observations
  TO sportos_app, sportos_legacy, sportos_worker_data;

DO $$
BEGIN
  IF NOT has_table_privilege('sportos_worker_data', 'garmin_observations', 'SELECT, INSERT, UPDATE') THEN
    RAISE EXCEPTION 'sportos_worker_data must operate owner-scoped garmin_observations';
  END IF;
  IF has_table_privilege('sportos_worker', 'garmin_observations', 'SELECT')
     OR has_table_privilege('sportos_worker', 'garmin_observations', 'INSERT')
     OR has_table_privilege('sportos_worker', 'garmin_observations', 'UPDATE') THEN
    RAISE EXCEPTION 'sportos_worker dispatcher must not access garmin_observations';
  END IF;
END $$;
