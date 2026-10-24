-- A manual activity-distance correction is an owner-scoped effective value.
-- Provider rows, FIT resources and canonical source facts remain immutable;
-- this projection is applied only by read/scoring paths that explicitly use
-- effective activity facts.

ALTER TABLE daily_score_snapshots
  DROP CONSTRAINT daily_score_snapshots_trigger_check,
  ADD CONSTRAINT daily_score_snapshots_trigger_check CHECK (trigger IN (
    'workbook_import', 'manual_edit', 'manual_recalculation',
    'rule_recomputation', 'legacy_migration', 'activity_distance_correction'
  ));

CREATE TABLE activity_distance_corrections (
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id) ON DELETE RESTRICT,
  activity_id uuid NOT NULL,
  effective_distance_m numeric(12,2) NOT NULL CHECK (effective_distance_m > 0 AND effective_distance_m <= 1000000),
  recorded_distance_m numeric(12,2) NOT NULL CHECK (recorded_distance_m > 0 AND recorded_distance_m <= 1000000),
  recorded_source text NOT NULL CHECK (recorded_source IN ('manual','my_sport_xlsx','run_db_xlsx','google_sheets','strava','garmin','fit')),
  recorded_source_activity_id text,
  recorded_source_record_id uuid,
  recorded_source_hash char(64) CHECK (recorded_source_hash IS NULL OR recorded_source_hash ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  actor_account_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, activity_id),
  CONSTRAINT activity_distance_corrections_activity_fk
    FOREIGN KEY (owner_id, activity_id) REFERENCES activities(owner_id, id) ON DELETE CASCADE,
  CONSTRAINT activity_distance_corrections_actor_owner_ck CHECK (actor_account_id = owner_id)
);

CREATE TABLE activity_distance_correction_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id) ON DELETE RESTRICT,
  activity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('save','reset')),
  effective_distance_m numeric(12,2) CHECK (effective_distance_m IS NULL OR (effective_distance_m > 0 AND effective_distance_m <= 1000000)),
  previous_effective_distance_m numeric(12,2) CHECK (previous_effective_distance_m IS NULL OR (previous_effective_distance_m > 0 AND previous_effective_distance_m <= 1000000)),
  recorded_distance_m numeric(12,2) CHECK (recorded_distance_m IS NULL OR (recorded_distance_m > 0 AND recorded_distance_m <= 1000000)),
  recorded_source text CHECK (recorded_source IS NULL OR recorded_source IN ('manual','my_sport_xlsx','run_db_xlsx','google_sheets','strava','garmin','fit')),
  recorded_source_activity_id text,
  recorded_source_record_id uuid,
  recorded_source_hash char(64) CHECK (recorded_source_hash IS NULL OR recorded_source_hash ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  revision integer NOT NULL CHECK (revision > 0),
  actor_account_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_distance_correction_history_actor_owner_ck CHECK (actor_account_id = owner_id),
  CONSTRAINT activity_distance_correction_history_action_ck CHECK (
    (action = 'save' AND effective_distance_m IS NOT NULL)
    OR (action = 'reset' AND effective_distance_m IS NULL)
  )
);

CREATE INDEX activity_distance_correction_history_lookup
  ON activity_distance_correction_history(owner_id, activity_id, created_at DESC, id DESC);

CREATE FUNCTION sportos_check_activity_distance_correction_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target record;
BEGIN
  SELECT activity_type, subtype INTO target
  FROM activities
  WHERE owner_id = NEW.owner_id AND id = NEW.activity_id;
  IF NOT FOUND OR target.activity_type <> 'swim' OR target.subtype <> 'indoor' THEN
    RAISE EXCEPTION 'Distance corrections require an indoor swim activity';
  END IF;
  IF NEW.actor_account_id IS DISTINCT FROM sportos_current_account_id()
     OR NEW.owner_id IS DISTINCT FROM sportos_current_account_id() THEN
    RAISE EXCEPTION 'Distance correction actor must be the current account';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER check_activity_distance_correction_target
  BEFORE INSERT OR UPDATE ON activity_distance_corrections
  FOR EACH ROW EXECUTE FUNCTION sportos_check_activity_distance_correction_target();

CREATE FUNCTION sportos_check_activity_distance_correction_history_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.actor_account_id IS DISTINCT FROM sportos_current_account_id()
     OR NEW.owner_id IS DISTINCT FROM sportos_current_account_id() THEN
    RAISE EXCEPTION 'Distance correction actor must be the current account';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM activities
    WHERE owner_id = NEW.owner_id AND id = NEW.activity_id
  ) THEN
    RAISE EXCEPTION 'Invalid canonical activity reference';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER check_activity_distance_correction_history_target
  BEFORE INSERT ON activity_distance_correction_history
  FOR EACH ROW EXECUTE FUNCTION sportos_check_activity_distance_correction_history_target();

CREATE FUNCTION sportos_reject_activity_distance_correction_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Activity distance correction history is append-only';
END;
$$;

CREATE TRIGGER reject_activity_distance_correction_history_mutation
  BEFORE UPDATE OR DELETE ON activity_distance_correction_history
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_activity_distance_correction_history_mutation();

ALTER TABLE activity_distance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_distance_corrections FORCE ROW LEVEL SECURITY;
ALTER TABLE activity_distance_correction_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_distance_correction_history FORCE ROW LEVEL SECURITY;

CREATE POLICY activity_distance_corrections_account_isolation
  ON activity_distance_corrections TO sportos_app, sportos_worker_data
  USING (owner_id = sportos_current_account_id())
  WITH CHECK (owner_id = sportos_current_account_id());
CREATE POLICY activity_distance_correction_history_account_isolation
  ON activity_distance_correction_history TO sportos_app
  USING (owner_id = sportos_current_account_id())
  WITH CHECK (owner_id = sportos_current_account_id());

CREATE TRIGGER reject_owner_change
  BEFORE UPDATE OF owner_id ON activity_distance_corrections
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();
CREATE TRIGGER reject_owner_change
  BEFORE UPDATE OF owner_id ON activity_distance_correction_history
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();

REVOKE ALL ON activity_distance_corrections, activity_distance_correction_history
  FROM PUBLIC, sportos_data, sportos_legacy, sportos_worker, sportos_worker_data, sportos_app;
GRANT SELECT ON activity_distance_corrections TO sportos_app, sportos_worker_data;
GRANT INSERT, UPDATE, DELETE ON activity_distance_corrections TO sportos_app;
GRANT SELECT, INSERT ON activity_distance_correction_history TO sportos_app;

DO $$
BEGIN
  IF NOT has_table_privilege('sportos_app', 'activity_distance_corrections', 'SELECT, INSERT, UPDATE, DELETE')
     OR NOT has_table_privilege('sportos_worker_data', 'activity_distance_corrections', 'SELECT')
     OR NOT has_table_privilege('sportos_app', 'activity_distance_correction_history', 'SELECT, INSERT') THEN
    RAISE EXCEPTION 'Invalid activity distance correction privileges';
  END IF;
  IF has_table_privilege('sportos_app', 'activity_distance_correction_history', 'UPDATE')
     OR has_table_privilege('sportos_app', 'activity_distance_correction_history', 'DELETE')
     OR has_table_privilege('sportos_worker', 'activity_distance_corrections', 'SELECT')
     OR has_table_privilege('sportos_worker_data', 'activity_distance_correction_history', 'SELECT') THEN
    RAISE EXCEPTION 'Activity distance correction roles are too broad';
  END IF;
END;
$$;
