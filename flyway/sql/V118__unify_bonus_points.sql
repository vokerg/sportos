-- Bonus points are the only live bonus concept. Preserve old ledger/snapshot
-- history, migrate canonical activities and current snapshot facts, version the
-- manual rule, then remove the duplicate daily power_points storage column.

DROP VIEW v_daily_summary;

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;
ALTER TABLE scoring_rules DROP CONSTRAINT IF EXISTS scoring_rules_activity_type_check;

UPDATE activities
SET activity_type = 'bonus'
WHERE activity_type = 'power_bonus';

UPDATE scoring_rules
SET activity_type = 'bonus'
WHERE activity_type = 'power_bonus';

ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type IN ('steps', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'bonus'));

ALTER TABLE scoring_rules ADD CONSTRAINT scoring_rules_activity_type_check
  CHECK (activity_type IN ('steps', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'bonus'));

UPDATE scoring_rules
SET enabled = false
WHERE code = 'power.manual' AND enabled;

-- Imported workbook totals were authoritative, but their recorded manual bonus
-- was historically left inside base_points. Reclassify that component without
-- changing a single total so bonus_points has one meaning for every authority
-- state and Dynamics no longer mixes zeroed imports with calculated bonuses.
ALTER TABLE daily_metrics DROP CONSTRAINT chk_daily_metrics_imported_score_authority;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM daily_metrics
    WHERE score_status = 'imported'
      AND power_points > total_points
  ) THEN
    RAISE EXCEPTION 'imported manual bonus cannot exceed the authoritative total';
  END IF;
END $$;

UPDATE daily_metrics
SET
  base_points = total_points - power_points,
  bonus_points = power_points
WHERE score_status = 'imported';

ALTER TABLE daily_metrics
  ADD CONSTRAINT chk_daily_metrics_imported_score_authority
  CHECK (
    score_status <> 'imported'
    OR (
      excel_all_points IS NOT NULL
      AND excel_all_points >= 0
      AND excel_all_points = trunc(excel_all_points)
      AND base_points >= 0
      AND bonus_points >= 0
      AND base_points + bonus_points = excel_all_points
      AND total_points = excel_all_points
    )
  );

INSERT INTO scoring_rules (
  owner_id, code, version, supersedes_rule_id, name, activity_type, rule_kind,
  metric, coefficient, threshold_operator, threshold_value, threshold_unit,
  points, achievement_group, points_multiplier, valid_from, valid_to, priority,
  enabled, description
)
SELECT
  legacy.owner_id,
  'bonus.manual',
  1,
  legacy.id,
  'Manual bonus points',
  'bonus',
  'manual_points',
  'effort_points',
  1.0,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  DATE '1900-01-01',
  NULL,
  60,
  true,
  'Exact imported or manually entered bonus points.'
FROM (
  SELECT DISTINCT ON (owner_id) owner_id, id
  FROM scoring_rules
  WHERE code = 'power.manual'
  ORDER BY owner_id, version DESC
) legacy
WHERE NOT EXISTS (
  SELECT 1
  FROM scoring_rules candidate
  WHERE candidate.owner_id = legacy.owner_id
    AND candidate.code = 'bonus.manual'
);

-- Current snapshots become the sole source of persisted scoring inputs that are
-- not current daily output columns. Old append-only snapshots remain untouched.
WITH normalized_snapshots AS (
  INSERT INTO daily_score_snapshots (
    owner_id, metric_date, score_status, base_points, bonus_points, total_points,
    facts_json, ledger_json, source_record_id, trigger
  )
  SELECT
    dm.owner_id,
    dm.metric_date,
    dm.score_status,
    dm.base_points,
    dm.bonus_points,
    dm.total_points,
    (snapshot.facts_json - 'powerPoints')
      || jsonb_build_object('bonusPoints', dm.power_points),
    snapshot.ledger_json,
    dm.source_record_id,
    'legacy_migration'
  FROM daily_metrics dm
  JOIN daily_score_snapshots snapshot
    ON snapshot.owner_id = dm.owner_id
   AND snapshot.id = dm.score_snapshot_id
  RETURNING owner_id, metric_date, id
)
UPDATE daily_metrics dm
SET score_snapshot_id = normalized.id
FROM normalized_snapshots normalized
WHERE normalized.owner_id = dm.owner_id
  AND normalized.metric_date = dm.metric_date;

ALTER TABLE daily_metrics DROP COLUMN power_points;

CREATE VIEW v_daily_summary WITH (security_invoker = true) AS
SELECT
  dm.metric_date,
  dm.steps,
  dm.run_m,
  dm.bike_m,
  dm.swim_m,
  dm.workout_points,
  dm.base_points,
  dm.bonus_points,
  dm.total_points,
  dm.excel_all_points,
  CASE WHEN dm.excel_all_points IS NULL THEN NULL ELSE dm.total_points - dm.excel_all_points END AS points_delta_vs_excel,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS avg_10d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS avg_20d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS avg_30d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 59 PRECEDING AND CURRENT ROW) AS avg_60d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 364 PRECEDING AND CURRENT ROW) AS avg_365d,
  dm.recomputed_at,
  dm.score_status
FROM daily_metrics dm;

GRANT SELECT ON v_daily_summary TO sportos_data;

-- New accounts receive the canonical catalog only. The disabled legacy rule is
-- retained solely for accounts whose historical ledgers already reference it.
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
    points, achievement_group, points_multiplier, valid_from, valid_to, priority,
    enabled, description, created_at
  )
  SELECT
    target_account_id, code, version, NULL, name, activity_type, rule_kind,
    metric, coefficient, threshold_operator, threshold_value, threshold_unit,
    points, achievement_group, points_multiplier, valid_from, valid_to, priority,
    enabled, description, now()
  FROM scoring_rules
  WHERE owner_id = '00000000-0000-4000-8000-000000000001'
    AND code <> 'power.manual'
  ORDER BY code, version;
END;
$$;

REVOKE ALL ON FUNCTION sportos_seed_account_rules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sportos_seed_account_rules(uuid) TO sportos_app;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'daily_metrics'
      AND column_name = 'power_points'
  ) THEN
    RAISE EXCEPTION 'daily_metrics.power_points must be removed';
  END IF;
  IF EXISTS (SELECT 1 FROM activities WHERE activity_type = 'power_bonus')
     OR EXISTS (SELECT 1 FROM scoring_rules WHERE activity_type = 'power_bonus') THEN
    RAISE EXCEPTION 'legacy power_bonus activity types must be migrated';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM daily_metrics dm
    LEFT JOIN daily_score_snapshots snapshot
      ON snapshot.owner_id = dm.owner_id AND snapshot.id = dm.score_snapshot_id
    WHERE snapshot.id IS NULL OR NOT (snapshot.facts_json ? 'bonusPoints')
  ) THEN
    RAISE EXCEPTION 'every current daily score must reference normalized bonus facts';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM daily_metrics
    WHERE base_points + bonus_points <> total_points
  ) THEN
    RAISE EXCEPTION 'daily base and bonus components must preserve every total';
  END IF;
END $$;
