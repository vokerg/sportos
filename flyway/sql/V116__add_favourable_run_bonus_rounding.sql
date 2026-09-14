-- Preserve the strict V115 run-pace rules as immutable history and replace them
-- with explicit rule versions whose multiplier records favourable eligibility
-- rounding: nearest 0.1 km for blocks and nearest 0.1 min/km for pace.

ALTER TABLE scoring_rules DROP CONSTRAINT chk_scoring_rules_points_multiplier;
ALTER TABLE scoring_rules
  ADD CONSTRAINT chk_scoring_rules_points_multiplier
    CHECK (points_multiplier IS NULL OR points_multiplier IN ('completed_5k_blocks', 'rounded_5k_blocks')),
  ADD CONSTRAINT chk_scoring_rules_rounded_multiplier_operator
    CHECK (points_multiplier <> 'rounded_5k_blocks' OR threshold_operator = 'lte');

CREATE TEMP TABLE rounded_run_pace_previous_rules ON COMMIT DROP AS
SELECT
  sr.*,
  (SELECT max(candidate.version) + 1
   FROM scoring_rules candidate
   WHERE candidate.owner_id = sr.owner_id AND candidate.code = sr.code) AS next_version
FROM scoring_rules sr
WHERE sr.enabled = true
  AND sr.achievement_group = 'run.pace.per5k'
  AND sr.points_multiplier = 'completed_5k_blocks'
  AND sr.code IN (
    'run.pace.per5k.sub5.bonus',
    'run.pace.per5k.sub4m24.bonus',
    'run.pace.per5k.sub4m12.bonus',
    'run.pace.per5k.sub4.bonus'
  );

UPDATE scoring_rules sr
SET enabled = false
FROM rounded_run_pace_previous_rules previous
WHERE sr.owner_id = previous.owner_id AND sr.id = previous.id;

INSERT INTO scoring_rules (
  owner_id, code, version, supersedes_rule_id, name, activity_type, rule_kind,
  metric, coefficient, threshold_operator, threshold_value, threshold_unit,
  points, achievement_group, points_multiplier, valid_from, valid_to, priority,
  enabled, description
)
SELECT
  owner_id,
  code,
  next_version,
  id,
  replace(name, 'pace under', 'rounded pace at or under'),
  activity_type,
  rule_kind,
  metric,
  coefficient,
  'lte',
  threshold_value,
  threshold_unit,
  points,
  achievement_group,
  'rounded_5k_blocks',
  valid_from,
  valid_to,
  priority,
  true,
  'SportOS bonus. Distance is rounded to the nearest 0.1 km and overall elapsed pace to the nearest 0.1 min/km; a rounded pace on the boundary qualifies. Award points per rounded completed 5 km block, with only the highest matching run.pace.per5k tier applying.'
FROM rounded_run_pace_previous_rules;

-- Replace current run-pace contributions for every non-imported day in the same
-- transaction, then append a complete post-recomputation score snapshot.
CREATE TEMP TABLE rounded_run_pace_bonus_recompute ON COMMIT DROP AS
WITH old_bonus AS (
  SELECT sl.owner_id, sl.metric_date, sum(sl.points)::integer AS points
  FROM score_ledger sl
  JOIN rounded_run_pace_previous_rules previous
    ON previous.owner_id = sl.owner_id AND previous.id = sl.rule_id
  GROUP BY sl.owner_id, sl.metric_date
),
new_bonus AS (
  SELECT
    activity.owner_id,
    activity.activity_date AS metric_date,
    sum(floor((round(activity.distance_m / 100.0) * 100) / 5000)::integer * tier.points)::integer AS points
  FROM activities activity
  JOIN LATERAL (
    SELECT sr.points
    FROM scoring_rules sr
    WHERE sr.owner_id = activity.owner_id
      AND sr.enabled = true
      AND sr.achievement_group = 'run.pace.per5k'
      AND sr.points_multiplier = 'rounded_5k_blocks'
      AND round((activity.duration_s / (NULLIF(activity.distance_m, 0) / 1000.0)) / 6.0) * 6 <= sr.threshold_value
    ORDER BY sr.points DESC, sr.priority ASC, sr.code ASC
    LIMIT 1
  ) tier ON true
  WHERE activity.activity_type = 'run'
    AND round(activity.distance_m / 100.0) * 100 >= 5000
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
USING rounded_run_pace_previous_rules previous, rounded_run_pace_bonus_recompute affected
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
  tier.id,
  floor(tier.rounded_distance_m / 5000)::integer * tier.points,
  tier.name || ': '
    || round(tier.raw_pace, 3)::text || ' s/km rounded to '
    || tier.rounded_pace::text || ' s/km lte ' || tier.threshold_value::text || ' s/km; '
    || floor(tier.rounded_distance_m / 5000)::integer::text || ' completed 5 km blocks x '
    || tier.points::text || ' = '
    || (floor(tier.rounded_distance_m / 5000)::integer * tier.points)::text,
  jsonb_build_object(
    'ruleKind', 'achievement',
    'classification', 'bonus',
    'activityType', 'run',
    'metric', 'pace_s_per_km',
    'metricUnit', 's/km',
    'metricValue', tier.raw_pace,
    'thresholdComparisonValue', tier.rounded_pace,
    'thresholdOperator', 'lte',
    'thresholdValue', tier.threshold_value,
    'thresholdUnit', 's/km',
    'eligibilityRounding', 'nearest_0.1_km_and_0.1_min_per_km_favouring_boundary',
    'configuredPoints', tier.points,
    'achievementGroup', tier.achievement_group,
    'pointsMultiplier', tier.points_multiplier,
    'multiplierInputValue', tier.rounded_distance_m,
    'multiplierValue', floor(tier.rounded_distance_m / 5000)::integer,
    'awardedPoints', floor(tier.rounded_distance_m / 5000)::integer * tier.points,
    'auxiliaryConditions', '[]'::jsonb,
    'validFrom', tier.valid_from::text,
    'validTo', CASE WHEN tier.valid_to IS NULL THEN NULL ELSE tier.valid_to::text END,
    'priority', tier.priority
  )
FROM activities activity
JOIN rounded_run_pace_bonus_recompute affected
  ON affected.owner_id = activity.owner_id AND affected.metric_date = activity.activity_date
JOIN LATERAL (
  SELECT
    sr.*,
    activity.duration_s / (NULLIF(activity.distance_m, 0) / 1000.0) AS raw_pace,
    round((activity.duration_s / (NULLIF(activity.distance_m, 0) / 1000.0)) / 6.0) * 6 AS rounded_pace,
    round(activity.distance_m / 100.0) * 100 AS rounded_distance_m
  FROM scoring_rules sr
  WHERE sr.owner_id = activity.owner_id
    AND sr.enabled = true
    AND sr.achievement_group = 'run.pace.per5k'
    AND sr.points_multiplier = 'rounded_5k_blocks'
    AND round((activity.duration_s / (NULLIF(activity.distance_m, 0) / 1000.0)) / 6.0) * 6 <= sr.threshold_value
  ORDER BY sr.points DESC, sr.priority ASC, sr.code ASC
  LIMIT 1
) tier ON true
WHERE activity.activity_type = 'run'
  AND tier.rounded_distance_m >= 5000
  AND activity.duration_s IS NOT NULL
  AND activity.duration_s > 0;

UPDATE daily_metrics dm
SET
  bonus_points = dm.bonus_points - affected.old_points + affected.new_points,
  total_points = dm.total_points - affected.old_points + affected.new_points,
  recomputed_at = now()
FROM rounded_run_pace_bonus_recompute affected
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
  JOIN rounded_run_pace_bonus_recompute affected
    ON affected.owner_id = dm.owner_id AND affected.metric_date = dm.metric_date
  RETURNING owner_id, metric_date, id
)
UPDATE daily_metrics dm
SET score_snapshot_id = snapshots.id
FROM snapshots
WHERE snapshots.owner_id = dm.owner_id
  AND snapshots.metric_date = dm.metric_date;
