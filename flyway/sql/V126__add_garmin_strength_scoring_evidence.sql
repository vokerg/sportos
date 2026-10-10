-- Compact immutable evidence only. Original sets remain in the detail database.
ALTER TABLE garmin_activity_versions ADD CONSTRAINT uq_garmin_strength_version_reference
  UNIQUE (owner_id, identity_id, content_hash, id);
CREATE TABLE garmin_strength_summaries (
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  identity_id uuid NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  version_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version = 1),
  total_recorded_sets integer NOT NULL CHECK (total_recorded_sets BETWEEN 0 AND 2000),
  working_sets integer NOT NULL CHECK (working_sets BETWEEN 0 AND 2000),
  warmup_sets integer NOT NULL CHECK (warmup_sets BETWEEN 0 AND 2000),
  rest_markers integer NOT NULL CHECK (rest_markers BETWEEN 0 AND 2000),
  unknown_sets integer NOT NULL CHECK (unknown_sets BETWEEN 0 AND 2000),
  exercise_count integer NOT NULL CHECK (exercise_count BETWEEN 0 AND 2000),
  exercises_json jsonb NOT NULL CHECK (jsonb_typeof(exercises_json) = 'array' AND jsonb_array_length(exercises_json) <= 100 AND octet_length(exercises_json::text) <= 16384),
  complete boolean NOT NULL,
  derived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, identity_id, content_hash, policy_version),
  FOREIGN KEY (owner_id, identity_id, content_hash, version_id)
    REFERENCES garmin_activity_versions(owner_id, identity_id, content_hash, id),
  CHECK (total_recorded_sets = working_sets + warmup_sets + rest_markers + unknown_sets),
  CHECK (NOT complete OR (unknown_sets = 0 AND total_recorded_sets > 0 AND exercise_count <= 100))
);
ALTER TABLE garmin_strength_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE garmin_strength_summaries FORCE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON garmin_strength_summaries TO sportos_app, sportos_worker_data
  USING (owner_id = sportos_current_account_id()) WITH CHECK (owner_id = sportos_current_account_id());
CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON garmin_strength_summaries
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();
CREATE TRIGGER reject_history_mutation BEFORE UPDATE OR DELETE ON garmin_strength_summaries
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_garmin_history_mutation();
REVOKE ALL ON garmin_strength_summaries FROM PUBLIC, sportos_data, sportos_app, sportos_worker, sportos_worker_data, sportos_legacy;
GRANT SELECT, INSERT ON garmin_strength_summaries TO sportos_app, sportos_worker_data;

-- New source-neutral UUIDs; no historical ledger/snapshot or scoring changes.
CREATE TEMP TABLE replaced_workout_rules ON COMMIT DROP AS
  SELECT * FROM scoring_rules WHERE code = 'workout.manual' AND enabled;
UPDATE scoring_rules SET enabled = false WHERE code = 'workout.manual' AND enabled;
INSERT INTO scoring_rules (owner_id, code, version, supersedes_rule_id, name,
  activity_type, rule_kind, metric, coefficient, valid_from, valid_to, priority, enabled, description)
SELECT owner_id, 'workout.points', version, id, 'Workout points', activity_type,
  rule_kind, metric, coefficient, valid_from, valid_to, priority, true,
  'Resolved workout effort points, converted 1:1. Source authority is recorded in score calculation metadata.'
FROM replaced_workout_rules;
-- The existing account seed function copies this catalog; exclude disabled old
-- workout.manual rows so new accounts receive only the source-neutral family.
CREATE OR REPLACE FUNCTION sportos_seed_account_rules(target_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF target_account_id IS DISTINCT FROM sportos_current_account_id() THEN
    RAISE EXCEPTION 'target account does not match request context';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = target_account_id AND status = 'active') THEN
    RAISE EXCEPTION 'target account is not active';
  END IF;
  IF EXISTS (SELECT 1 FROM scoring_rules WHERE owner_id = target_account_id) THEN RETURN; END IF;
  INSERT INTO scoring_rules (owner_id, code, version, supersedes_rule_id, name, activity_type,
    rule_kind, metric, coefficient, threshold_operator, threshold_value, threshold_unit,
    points, achievement_group, points_multiplier, valid_from, valid_to, priority, enabled, description, created_at)
  SELECT target_account_id, code, version, NULL, name, activity_type, rule_kind, metric,
    coefficient, threshold_operator, threshold_value, threshold_unit, points, achievement_group,
    points_multiplier, valid_from, valid_to, priority, enabled, description, now()
  FROM scoring_rules WHERE owner_id = '00000000-0000-4000-8000-000000000001'
    AND code NOT IN ('power.manual', 'workout.manual') ORDER BY code, version;
END;
$$;
REVOKE ALL ON FUNCTION sportos_seed_account_rules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sportos_seed_account_rules(uuid) TO sportos_app;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['sportos_app','sportos_worker_data'] LOOP
    IF NOT has_table_privilege(r,'garmin_strength_summaries','SELECT, INSERT')
      OR has_table_privilege(r,'garmin_strength_summaries','UPDATE')
      OR has_table_privilege(r,'garmin_strength_summaries','DELETE') THEN RAISE EXCEPTION 'Invalid strength evidence privileges'; END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['sportos_worker','sportos_legacy','sportos_data'] LOOP
    IF has_table_privilege(r,'garmin_strength_summaries','SELECT') THEN RAISE EXCEPTION 'Invalid strength evidence read privilege'; END IF;
  END LOOP;
END $$;
