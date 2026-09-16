-- Treat a 10 km ride within 0.1 km/h of the 20 km/h target as qualifying.
-- Preserve the strict V114 definition as an immutable, disabled rule version
-- and atomically recompute calculated rows against the replacement UUID.

CREATE TEMP TABLE bike_speed_previous_rules ON COMMIT DROP AS
SELECT sr.*
FROM scoring_rules sr
WHERE sr.code = 'bike.10k.easy.bonus'
  AND sr.version = 2
  AND sr.enabled = true
  AND sr.activity_type = 'bike'
  AND sr.rule_kind = 'achievement'
  AND sr.metric = 'avg_speed_kmh'
  AND sr.threshold_operator = 'gt'
  AND sr.threshold_value = 20
  AND sr.threshold_unit = 'kmh'
  AND sr.points = 1000;

UPDATE scoring_rules sr
SET enabled = false
FROM bike_speed_previous_rules previous
WHERE sr.owner_id = previous.owner_id
  AND sr.id = previous.id;

INSERT INTO scoring_rules (
  owner_id,
  code,
  version,
  supersedes_rule_id,
  name,
  activity_type,
  rule_kind,
  metric,
  coefficient,
  threshold_operator,
  threshold_value,
  threshold_unit,
  points,
  valid_from,
  valid_to,
  priority,
  enabled,
  description
)
SELECT
  owner_id,
  code,
  version + 1,
  id,
  '10k ride at the 20 km/h boundary',
  activity_type,
  rule_kind,
  metric,
  coefficient,
  'gte',
  19.9,
  threshold_unit,
  points,
  valid_from,
  valid_to,
  priority,
  true,
  'SportOS bonus. Award 1000 points when one canonical bike activity covers at least 10000 meters and its average speed is at least 19.9 km/h, providing a bounded 0.1 km/h tolerance around the 20 km/h target. Effective from 1900-01-01.'
FROM bike_speed_previous_rules;

CREATE TEMP TABLE bike_speed_bonus_recompute ON COMMIT DROP AS
WITH old_bonus AS (
  SELECT sl.owner_id, sl.metric_date, sum(sl.points)::integer AS points
  FROM score_ledger sl
  JOIN bike_speed_previous_rules previous
    ON previous.owner_id = sl.owner_id AND previous.id = sl.rule_id
  GROUP BY sl.owner_id, sl.metric_date
),
new_bonus AS (
  SELECT activity.owner_id, activity.activity_date AS metric_date, sum(rule.points)::integer AS points
  FROM activities activity
  JOIN scoring_rules rule
    ON rule.owner_id = activity.owner_id
   AND rule.supersedes_rule_id IN (
     SELECT previous.id
     FROM bike_speed_previous_rules previous
     WHERE previous.owner_id = activity.owner_id
   )
   AND rule.enabled = true
  WHERE activity.activity_type = 'bike'
    AND activity.distance_m >= 10000
    AND activity.avg_speed_mps IS NOT NULL
    AND activity.avg_speed_mps * 3.6 >= rule.threshold_value
    AND activity.activity_date >= rule.valid_from
    AND (rule.valid_to IS NULL OR activity.activity_date <= rule.valid_to)
  GROUP BY activity.owner_id, activity.activity_date
)
SELECT
  dm.owner_id,
  dm.metric_date,
  coalesce(old_bonus.points, 0) AS old_points,
  coalesce(new_bonus.points, 0) AS new_points
FROM daily_metrics dm
LEFT JOIN old_bonus
  ON old_bonus.owner_id = dm.owner_id AND old_bonus.metric_date = dm.metric_date
LEFT JOIN new_bonus
  ON new_bonus.owner_id = dm.owner_id AND new_bonus.metric_date = dm.metric_date
WHERE dm.score_status = 'calculated'
  AND (coalesce(old_bonus.points, 0) <> 0 OR coalesce(new_bonus.points, 0) <> 0);

DELETE FROM score_ledger sl
USING bike_speed_previous_rules previous, bike_speed_bonus_recompute affected
WHERE previous.owner_id = sl.owner_id
  AND previous.id = sl.rule_id
  AND affected.owner_id = sl.owner_id
  AND affected.metric_date = sl.metric_date;

INSERT INTO score_ledger (
  owner_id, metric_date, activity_id, rule_id, points, reason, calculation_json
)
SELECT
  activity.owner_id,
  activity.activity_date,
  activity.id,
  rule.id,
  rule.points,
  rule.name || ': ' || round((activity.avg_speed_mps * 3.6)::numeric, 3)::text
    || ' km/h gte ' || rule.threshold_value::text || ' km/h; +' || rule.points::text,
  jsonb_build_object(
    'ruleKind', 'achievement',
    'classification', 'bonus',
    'activityType', 'bike',
    'metric', 'avg_speed_kmh',
    'metricUnit', 'km/h',
    'metricValue', activity.avg_speed_mps * 3.6,
    'thresholdComparisonValue', activity.avg_speed_mps * 3.6,
    'thresholdOperator', rule.threshold_operator,
    'thresholdValue', rule.threshold_value,
    'thresholdUnit', rule.threshold_unit,
    'eligibilityRounding', NULL,
    'configuredPoints', rule.points,
    'achievementGroup', rule.achievement_group,
    'pointsMultiplier', rule.points_multiplier,
    'multiplierInputValue', NULL,
    'multiplierValue', 1,
    'awardedPoints', rule.points,
    'auxiliaryConditions', jsonb_build_array(jsonb_build_object(
      'metric', 'distance_m',
      'operator', 'gte',
      'expected', 10000,
      'actual', activity.distance_m,
      'passed', true
    )),
    'validFrom', rule.valid_from::text,
    'validTo', CASE WHEN rule.valid_to IS NULL THEN NULL ELSE rule.valid_to::text END,
    'priority', rule.priority
  )
FROM activities activity
JOIN bike_speed_bonus_recompute affected
  ON affected.owner_id = activity.owner_id AND affected.metric_date = activity.activity_date
JOIN scoring_rules rule
  ON rule.owner_id = activity.owner_id
 AND rule.supersedes_rule_id IN (
   SELECT previous.id
   FROM bike_speed_previous_rules previous
   WHERE previous.owner_id = activity.owner_id
 )
 AND rule.enabled = true
WHERE activity.activity_type = 'bike'
  AND activity.distance_m >= 10000
  AND activity.avg_speed_mps IS NOT NULL
  AND activity.avg_speed_mps * 3.6 >= rule.threshold_value
  AND activity.activity_date >= rule.valid_from
  AND (rule.valid_to IS NULL OR activity.activity_date <= rule.valid_to);

UPDATE daily_metrics dm
SET
  bonus_points = dm.bonus_points - affected.old_points + affected.new_points,
  total_points = dm.total_points - affected.old_points + affected.new_points,
  recomputed_at = now()
FROM bike_speed_bonus_recompute affected
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
  JOIN bike_speed_bonus_recompute affected
    ON affected.owner_id = dm.owner_id AND affected.metric_date = dm.metric_date
  RETURNING owner_id, metric_date, id
)
UPDATE daily_metrics dm
SET score_snapshot_id = snapshots.id
FROM snapshots
WHERE snapshots.owner_id = dm.owner_id
  AND snapshots.metric_date = dm.metric_date;
