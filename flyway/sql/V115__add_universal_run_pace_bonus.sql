-- Replace distance-specific running achievements with a universal, grouped pace
-- ladder. Only the highest matching tier applies to each canonical run, and its
-- configured points are multiplied by the number of completed 5 km blocks.

ALTER TABLE scoring_rules
  ADD COLUMN achievement_group text,
  ADD COLUMN points_multiplier text;

ALTER TABLE scoring_rules
  ADD CONSTRAINT chk_scoring_rules_achievement_group
    CHECK (achievement_group IS NULL OR (
      char_length(achievement_group) BETWEEN 1 AND 120
      AND achievement_group ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    )),
  ADD CONSTRAINT chk_scoring_rules_points_multiplier
    CHECK (points_multiplier IS NULL OR points_multiplier = 'completed_5k_blocks'),
  ADD CONSTRAINT chk_scoring_rules_block_multiplier_shape
    CHECK (
      points_multiplier IS NULL
      OR (
        rule_kind = 'achievement'
        AND activity_type = 'run'
        AND metric = 'pace_s_per_km'
        AND achievement_group IS NOT NULL
      )
    );

-- Retain the superseded distance-specific definitions and their immutable UUIDs.
UPDATE scoring_rules
SET enabled = false
WHERE code IN ('run.5k.sub25.bonus', 'run.10k.completed.bonus')
  AND enabled = true;

INSERT INTO scoring_rules (
  owner_id, code, version, supersedes_rule_id, name, activity_type, rule_kind,
  metric, coefficient, threshold_operator, threshold_value, threshold_unit,
  points, achievement_group, points_multiplier, valid_from, valid_to, priority,
  enabled, description
)
SELECT
  account.id,
  tier.code,
  1,
  NULL,
  tier.name,
  'run',
  'achievement',
  'pace_s_per_km',
  NULL,
  'lt',
  tier.threshold_value,
  's/km',
  tier.points,
  'run.pace.per5k',
  'completed_5k_blocks',
  DATE '1900-01-01',
  NULL,
  tier.priority,
  true,
  tier.description
FROM accounts account
CROSS JOIN (VALUES
  (
    'run.pace.per5k.sub5.bonus',
    'Run pace under 5:00/km',
    300::numeric,
    1000,
    70,
    'SportOS bonus. Award 1000 points per completed 5 km of one canonical run when its overall elapsed pace is strictly below 300 seconds per kilometer. Only the highest matching run.pace.per5k tier applies. Effective from 1900-01-01.'
  ),
  (
    'run.pace.per5k.sub4m24.bonus',
    'Run pace under 4:24/km',
    264::numeric,
    2000,
    71,
    'SportOS bonus. Award 2000 points per completed 5 km of one canonical run when its overall elapsed pace is strictly below 264 seconds per kilometer. Only the highest matching run.pace.per5k tier applies. Effective from 1900-01-01.'
  ),
  (
    'run.pace.per5k.sub4m12.bonus',
    'Run pace under 4:12/km',
    252::numeric,
    3000,
    72,
    'SportOS bonus. Award 3000 points per completed 5 km of one canonical run when its overall elapsed pace is strictly below 252 seconds per kilometer. Only the highest matching run.pace.per5k tier applies. Effective from 1900-01-01.'
  ),
  (
    'run.pace.per5k.sub4.bonus',
    'Run pace under 4:00/km',
    240::numeric,
    4000,
    73,
    'SportOS bonus. Award 4000 points per completed 5 km of one canonical run when its overall elapsed pace is strictly below 240 seconds per kilometer. Only the highest matching run.pace.per5k tier applies. Effective from 1900-01-01.'
  )
) AS tier(code, name, threshold_value, points, priority, description)
WHERE account.status = 'active';

-- Capture every non-imported day whose running achievement ledger changes. The
-- migration transaction then replaces those contributions and appends a complete
-- score snapshot, preserving the same atomic history guarantee as rule jobs.
CREATE TEMP TABLE run_pace_bonus_recompute ON COMMIT DROP AS
WITH old_bonus AS (
  SELECT sl.owner_id, sl.metric_date, sum(sl.points)::integer AS points
  FROM score_ledger sl
  JOIN scoring_rules sr ON sr.owner_id = sl.owner_id AND sr.id = sl.rule_id
  WHERE sr.code IN ('run.5k.sub25.bonus', 'run.10k.completed.bonus')
  GROUP BY sl.owner_id, sl.metric_date
),
new_bonus AS (
  SELECT
    activity.owner_id,
    activity.activity_date AS metric_date,
    sum(floor(activity.distance_m / 5000)::integer * tier.points)::integer AS points
  FROM activities activity
  JOIN LATERAL (
    SELECT sr.points
    FROM scoring_rules sr
    WHERE sr.owner_id = activity.owner_id
      AND sr.enabled = true
      AND sr.achievement_group = 'run.pace.per5k'
      AND sr.points_multiplier = 'completed_5k_blocks'
      AND activity.duration_s / (NULLIF(activity.distance_m, 0) / 1000.0) < sr.threshold_value
    ORDER BY sr.points DESC, sr.priority ASC, sr.code ASC
    LIMIT 1
  ) tier ON true
  WHERE activity.activity_type = 'run'
    AND activity.distance_m >= 5000
    AND activity.duration_s IS NOT NULL
    AND activity.duration_s > 0
  GROUP BY activity.owner_id, activity.activity_date
)
SELECT
  dm.owner_id,
  dm.metric_date,
  coalesce(old_bonus.points, 0) AS old_points,
  coalesce(new_bonus.points, 0) AS new_points
FROM daily_metrics dm
LEFT JOIN old_bonus ON old_bonus.owner_id = dm.owner_id AND old_bonus.metric_date = dm.metric_date
LEFT JOIN new_bonus ON new_bonus.owner_id = dm.owner_id AND new_bonus.metric_date = dm.metric_date
WHERE dm.score_status <> 'imported'
  AND (coalesce(old_bonus.points, 0) <> 0 OR coalesce(new_bonus.points, 0) <> 0);

DELETE FROM score_ledger sl
USING scoring_rules sr, run_pace_bonus_recompute affected
WHERE sr.owner_id = sl.owner_id
  AND sr.id = sl.rule_id
  AND affected.owner_id = sl.owner_id
  AND affected.metric_date = sl.metric_date
  AND sr.code IN ('run.5k.sub25.bonus', 'run.10k.completed.bonus');

INSERT INTO score_ledger (
  owner_id, metric_date, activity_id, rule_id, points, reason, calculation_json
)
SELECT
  activity.owner_id,
  activity.activity_date,
  activity.id,
  tier.id,
  floor(activity.distance_m / 5000)::integer * tier.points,
  tier.name || ': '
    || round(activity.duration_s / (activity.distance_m / 1000.0), 3)::text
    || ' s/km lt ' || tier.threshold_value::text || ' s/km; '
    || floor(activity.distance_m / 5000)::integer::text || ' completed 5 km blocks × '
    || tier.points::text || ' = '
    || (floor(activity.distance_m / 5000)::integer * tier.points)::text,
  jsonb_build_object(
    'ruleKind', 'achievement',
    'classification', 'bonus',
    'activityType', 'run',
    'metric', 'pace_s_per_km',
    'metricUnit', 's/km',
    'metricValue', activity.duration_s / (activity.distance_m / 1000.0),
    'thresholdOperator', 'lt',
    'thresholdValue', tier.threshold_value,
    'thresholdUnit', 's/km',
    'configuredPoints', tier.points,
    'achievementGroup', tier.achievement_group,
    'pointsMultiplier', tier.points_multiplier,
    'multiplierValue', floor(activity.distance_m / 5000)::integer,
    'awardedPoints', floor(activity.distance_m / 5000)::integer * tier.points,
    'auxiliaryConditions', '[]'::jsonb,
    'validFrom', tier.valid_from::text,
    'validTo', CASE WHEN tier.valid_to IS NULL THEN NULL ELSE tier.valid_to::text END,
    'priority', tier.priority
  )
FROM activities activity
JOIN run_pace_bonus_recompute affected
  ON affected.owner_id = activity.owner_id AND affected.metric_date = activity.activity_date
JOIN LATERAL (
  SELECT sr.*
  FROM scoring_rules sr
  WHERE sr.owner_id = activity.owner_id
    AND sr.enabled = true
    AND sr.achievement_group = 'run.pace.per5k'
    AND sr.points_multiplier = 'completed_5k_blocks'
    AND activity.duration_s / (NULLIF(activity.distance_m, 0) / 1000.0) < sr.threshold_value
  ORDER BY sr.points DESC, sr.priority ASC, sr.code ASC
  LIMIT 1
) tier ON true
WHERE activity.activity_type = 'run'
  AND activity.distance_m >= 5000
  AND activity.duration_s IS NOT NULL
  AND activity.duration_s > 0;

UPDATE daily_metrics dm
SET
  bonus_points = dm.bonus_points - affected.old_points + affected.new_points,
  total_points = dm.total_points - affected.old_points + affected.new_points,
  recomputed_at = now()
FROM run_pace_bonus_recompute affected
WHERE affected.owner_id = dm.owner_id
  AND affected.metric_date = dm.metric_date;

WITH snapshots AS (
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
    jsonb_build_object(
      'metricDate', dm.metric_date::text,
      'steps', dm.steps,
      'runM', dm.run_m,
      'bikeM', dm.bike_m,
      'swimM', dm.swim_m,
      'workoutPoints', dm.workout_points,
      'powerPoints', dm.power_points,
      'excelAllPoints', dm.excel_all_points,
      'excelRowHash', dm.excel_row_hash
    ),
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'metricDate', ledger.metric_date::text,
        'activityId', ledger.activity_id,
        'ruleId', ledger.rule_id,
        'points', ledger.points,
        'reason', ledger.reason,
        'calculationJson', ledger.calculation_json
      ) ORDER BY ledger.created_at, ledger.id)
      FROM score_ledger ledger
      WHERE ledger.owner_id = dm.owner_id AND ledger.metric_date = dm.metric_date
    ), '[]'::jsonb),
    dm.source_record_id,
    'rule_recomputation'
  FROM daily_metrics dm
  JOIN run_pace_bonus_recompute affected
    ON affected.owner_id = dm.owner_id AND affected.metric_date = dm.metric_date
  RETURNING owner_id, metric_date, id
)
UPDATE daily_metrics dm
SET score_snapshot_id = snapshots.id
FROM snapshots
WHERE snapshots.owner_id = dm.owner_id
  AND snapshots.metric_date = dm.metric_date;

-- New accounts copy the complete versioned catalog, including achievement-group
-- and point-multiplier semantics, from the fixed legacy template account.
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
  ORDER BY code, version;
END;
$$;

REVOKE ALL ON FUNCTION sportos_seed_account_rules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sportos_seed_account_rules(uuid) TO sportos_app;
