-- Dedicated provider-detail cache database.
-- Identity and credentials remain in the primary database. This table deliberately
-- has no cross-database foreign keys; the API validates the canonical reference in
-- the primary account context before reading or writing these derived rows.

CREATE OR REPLACE FUNCTION sportos_activity_detail_current_account_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  value text := current_setting('sportos.account_id', true);
BEGIN
  IF value IS NULL OR value = '' THEN
    RETURN NULL;
  END IF;
  RETURN value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION sportos_activity_detail_reject_owner_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'owner_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE activity_provider_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_activity_detail_current_account_id(),
  activity_id uuid NOT NULL,
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 50),
  provider_activity_id text NOT NULL CHECK (char_length(provider_activity_id) BETWEEN 1 AND 200),
  resource_type text NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 100),
  availability text NOT NULL DEFAULT 'available'
    CHECK (availability IN ('available', 'unavailable')),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  provider_version char(64) NOT NULL CHECK (provider_version ~ '^[0-9a-f]{64}$'),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  payload_json jsonb NOT NULL DEFAULT 'null'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_activity_provider_resources_resource
    UNIQUE (owner_id, activity_id, provider, provider_activity_id, resource_type)
);

CREATE INDEX idx_activity_provider_resources_owner_activity
  ON activity_provider_resources (owner_id, activity_id, provider, provider_activity_id);

ALTER TABLE activity_provider_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_provider_resources FORCE ROW LEVEL SECURITY;

CREATE POLICY activity_provider_resources_account_isolation ON activity_provider_resources
  TO sportos_app
  USING (owner_id = sportos_activity_detail_current_account_id())
  WITH CHECK (owner_id = sportos_activity_detail_current_account_id());

CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON activity_provider_resources
  FOR EACH ROW EXECUTE FUNCTION sportos_activity_detail_reject_owner_change();

REVOKE ALL ON DATABASE sportos_activity_detail FROM PUBLIC;
GRANT CONNECT ON DATABASE sportos_activity_detail TO sportos_app;

REVOKE ALL ON TABLE activity_provider_resources FROM PUBLIC, sportos_app;
GRANT SELECT, INSERT, UPDATE ON TABLE activity_provider_resources TO sportos_app;
GRANT USAGE ON SCHEMA public TO sportos_app;
GRANT EXECUTE ON FUNCTION sportos_activity_detail_current_account_id() TO sportos_app;

DO $$
DECLARE
  runtime_role text;
BEGIN
  IF NOT has_table_privilege('sportos_app', 'activity_provider_resources', 'SELECT, INSERT, UPDATE') THEN
    RAISE EXCEPTION 'sportos_app must operate the owner-scoped activity provider detail cache';
  END IF;
  FOR runtime_role IN
    SELECT rolname FROM pg_roles
    WHERE rolname IN ('sportos_data', 'sportos_worker', 'sportos_worker_data', 'sportos_legacy')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE activity_provider_resources FROM %I', runtime_role);
    IF has_table_privilege(runtime_role, 'activity_provider_resources', 'SELECT') THEN
      RAISE EXCEPTION 'non-API runtime role % must not read activity provider detail cache', runtime_role;
    END IF;
  END LOOP;
END
$$;
