-- Lazy provider activity detail cache.
-- This table lives in the primary database for now so ownership/RLS remain identical
-- to canonical activity reads. The resource-oriented boundary is intentionally kept
-- independent so it can move to the dedicated activity-detail database later.

CREATE TABLE activity_provider_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id()
    REFERENCES accounts(id) ON DELETE RESTRICT,
  activity_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('strava')),
  provider_activity_id text NOT NULL CHECK (char_length(provider_activity_id) BETWEEN 1 AND 200),
  resource_type text NOT NULL CHECK (resource_type IN ('detail', 'streams', 'laps', 'zones')),
  availability text NOT NULL DEFAULT 'available'
    CHECK (availability IN ('available', 'unavailable')),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  provider_version char(64) NOT NULL CHECK (provider_version ~ '^[0-9a-f]{64}$'),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  payload_json jsonb NOT NULL DEFAULT 'null'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_provider_resources_owner_activity_fk
    FOREIGN KEY (owner_id, activity_id)
    REFERENCES activities(owner_id, id) ON DELETE CASCADE,
  CONSTRAINT uq_activity_provider_resources_owner_id UNIQUE (owner_id, id),
  CONSTRAINT uq_activity_provider_resources_resource
    UNIQUE (owner_id, activity_id, provider, provider_activity_id, resource_type)
);

CREATE INDEX idx_activity_provider_resources_owner_activity
  ON activity_provider_resources (owner_id, activity_id, provider, provider_activity_id);

ALTER TABLE activity_provider_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_provider_resources FORCE ROW LEVEL SECURITY;

CREATE POLICY activity_provider_resources_account_isolation ON activity_provider_resources
  TO sportos_app
  USING (owner_id = sportos_current_account_id())
  WITH CHECK (owner_id = sportos_current_account_id());

CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON activity_provider_resources
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();

REVOKE ALL ON activity_provider_resources
  FROM sportos_data, sportos_legacy, sportos_worker, sportos_worker_data, sportos_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON activity_provider_resources TO sportos_app;

DO $$
BEGIN
  IF NOT has_table_privilege('sportos_app', 'activity_provider_resources', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'sportos_app must operate owner-scoped activity_provider_resources';
  END IF;
  IF has_table_privilege('sportos_worker', 'activity_provider_resources', 'SELECT')
     OR has_table_privilege('sportos_worker_data', 'activity_provider_resources', 'SELECT')
     OR has_table_privilege('sportos_legacy', 'activity_provider_resources', 'SELECT') THEN
    RAISE EXCEPTION 'non-API runtime roles must not read activity provider detail cache';
  END IF;
END $$;
