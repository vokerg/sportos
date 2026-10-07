-- Garmin enrichment may predate a canonical activity. Key by the shared native
-- identity/fallback rather than inventing a canonical UUID for an unmatched row.
CREATE TABLE garmin_activity_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_activity_detail_current_account_id(),
  identity_key text NOT NULL CHECK (identity_key ~ '^(native:[0-9]{1,20}|fingerprint:v1:[0-9a-f]{64})$'),
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  resource_type text NOT NULL CHECK (resource_type IN ('detail','sets','laps','records','fit_manifest')),
  chunk_index integer NOT NULL DEFAULT 0 CHECK (chunk_index BETWEEN 0 AND 10000),
  resource_hash char(64) NOT NULL CHECK (resource_hash ~ '^[0-9a-f]{64}$'),
  payload_json jsonb NOT NULL CHECK (octet_length(payload_json::text) <= 5242880),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, identity_key, source_hash, resource_type, chunk_index)
);
CREATE INDEX idx_garmin_resources_owner_identity ON garmin_activity_resources(owner_id, identity_key, source_hash);
ALTER TABLE garmin_activity_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE garmin_activity_resources FORCE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON garmin_activity_resources TO sportos_app
  USING (owner_id = sportos_activity_detail_current_account_id())
  WITH CHECK (owner_id = sportos_activity_detail_current_account_id());
CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON garmin_activity_resources
  FOR EACH ROW EXECUTE FUNCTION sportos_activity_detail_reject_owner_change();
CREATE FUNCTION sportos_reject_garmin_resource_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Garmin resource versions are immutable'; END;
$$;
CREATE TRIGGER reject_resource_mutation BEFORE UPDATE OR DELETE ON garmin_activity_resources
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_garmin_resource_mutation();
REVOKE ALL ON garmin_activity_resources FROM PUBLIC, sportos_app;
GRANT SELECT, INSERT ON garmin_activity_resources TO sportos_app;
DO $$
DECLARE r text;
BEGIN
  IF NOT has_table_privilege('sportos_app', 'garmin_activity_resources', 'SELECT, INSERT')
    OR has_table_privilege('sportos_app', 'garmin_activity_resources', 'UPDATE')
    OR has_table_privilege('sportos_app', 'garmin_activity_resources', 'DELETE') THEN
    RAISE EXCEPTION 'Garmin resource grants must preserve immutable versions';
  END IF;
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('sportos_data','sportos_worker','sportos_worker_data','sportos_legacy') LOOP
    EXECUTE format('REVOKE ALL ON garmin_activity_resources FROM %I', r);
    IF has_table_privilege(r, 'garmin_activity_resources', 'SELECT') THEN RAISE EXCEPTION '% must not read Garmin details', r; END IF;
  END LOOP;
END;
$$;
