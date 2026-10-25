-- Preserve historical flat bike rule UUIDs and version the standard catalog.
-- Score updates and append-only snapshots commit atomically with publication.
LOCK TABLE scoring_rules, daily_metrics, score_ledger IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE scoring_rules DROP CONSTRAINT chk_scoring_rules_points_multiplier;
ALTER TABLE scoring_rules DROP CONSTRAINT chk_scoring_rules_block_multiplier_shape;
ALTER TABLE scoring_rules
  ADD CONSTRAINT chk_scoring_rules_points_multiplier
    CHECK (points_multiplier IS NULL OR points_multiplier IN (
      'completed_5k_blocks', 'rounded_5k_blocks', 'completed_1k_blocks', 'completed_10k_blocks')),
  ADD CONSTRAINT chk_scoring_rules_block_multiplier_shape CHECK (
    points_multiplier IS NULL OR (
      rule_kind = 'achievement' AND (
        (points_multiplier IN ('completed_5k_blocks', 'rounded_5k_blocks')
          AND activity_type = 'run' AND metric = 'pace_s_per_km' AND achievement_group IS NOT NULL)
        OR (points_multiplier = 'completed_1k_blocks' AND activity_type = 'swim'
          AND metric = 'moving_pace_s_per_km' AND achievement_group = 'swim.pace.1k'
          AND threshold_operator = 'lt')
        OR (points_multiplier = 'completed_10k_blocks' AND activity_type = 'bike'
          AND code = 'bike.10k.easy.bonus' AND metric = 'avg_speed_kmh'
          AND achievement_group IS NULL AND threshold_operator = 'gte')
      )
    ) IS TRUE
  );

CREATE TEMP TABLE bike_bonus_previous_rules ON COMMIT DROP AS
SELECT sr.* FROM scoring_rules sr
WHERE sr.code = 'bike.10k.easy.bonus' AND sr.enabled
  AND sr.activity_type = 'bike'
  AND sr.rule_kind = 'achievement' AND sr.metric = 'avg_speed_kmh'
  AND sr.threshold_operator = 'gte' AND sr.threshold_value = 19.9
  AND sr.threshold_unit IN ('kmh', 'km/h') AND sr.points = 1000
  AND sr.priority = 100 AND sr.coefficient IS NULL
  AND sr.achievement_group IS NULL AND sr.points_multiplier IS NULL;
-- An account with any customized enabled version keeps its family authority.
DELETE FROM bike_bonus_previous_rules previous
WHERE EXISTS (SELECT 1 FROM scoring_rules custom
  WHERE custom.owner_id = previous.owner_id AND custom.enabled
    AND custom.code = 'bike.10k.easy.bonus'
    AND NOT EXISTS (SELECT 1 FROM bike_bonus_previous_rules standard WHERE standard.id = custom.id));
UPDATE scoring_rules sr SET enabled = false
FROM bike_bonus_previous_rules previous
WHERE sr.owner_id = previous.owner_id AND sr.id = previous.id;

CREATE TEMP TABLE bike_bonus_new_rules ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO scoring_rules (
    owner_id, code, version, supersedes_rule_id, name, activity_type, rule_kind,
    metric, threshold_operator, threshold_value, threshold_unit, points,
    points_multiplier, valid_from, valid_to, priority, enabled, description
  )
  SELECT previous.owner_id, previous.code,
    (SELECT max(existing.version) FROM scoring_rules existing
      WHERE existing.owner_id = previous.owner_id AND existing.code = previous.code)
      + row_number() OVER (PARTITION BY previous.owner_id, previous.code ORDER BY previous.valid_from, previous.id)::integer,
    previous.id, 'Bike speed bonus per completed 10 km',
    'bike', 'achievement', 'avg_speed_kmh', 'gte', previous.threshold_value,
    'km/h', previous.points, 'completed_10k_blocks', previous.valid_from, previous.valid_to,
    previous.priority, true,
    'Award 1000 points per completed 10 km within one canonical ride: floor(distance meters / 10000) times 1000. Average speed must be at least 19.9 km/h (20 km/h target with 0.1 km/h tolerance). No distance rounding or combining separate rides.'
  FROM bike_bonus_previous_rules previous
  RETURNING *
) SELECT * FROM inserted;
-- sportos_seed_account_rules copies the versioned legacy-account catalog.

CREATE TEMP TABLE bike_bonus_new_contributions ON COMMIT DROP AS
SELECT activity.owner_id, activity.activity_date AS metric_date,
  activity.id AS activity_id, activity.distance_m,
  activity.avg_speed_mps * 3.6 AS speed,
  floor(activity.distance_m / 10000.0) AS multiplier,
  floor(activity.distance_m / 10000.0) * rule.points AS awarded_points,
  rule.id AS rule_id, rule.points, rule.name, rule.threshold_value,
  rule.valid_from, rule.valid_to, rule.priority
FROM activities activity
JOIN bike_bonus_new_rules rule ON rule.owner_id = activity.owner_id
  AND activity.activity_date >= rule.valid_from
  AND (rule.valid_to IS NULL OR activity.activity_date <= rule.valid_to)
WHERE activity.activity_type = 'bike' AND activity.distance_m >= 10000
  AND activity.distance_m < 'Infinity'::double precision
  AND activity.avg_speed_mps * 3.6 >= rule.threshold_value
  AND activity.avg_speed_mps < 'Infinity'::double precision;

CREATE TEMP TABLE bike_bonus_affected_days ON COMMIT DROP AS
WITH old_bonus AS (
  SELECT ledger.owner_id, ledger.metric_date, sum(ledger.points)::integer AS points
  FROM score_ledger ledger JOIN bike_bonus_previous_rules previous
    ON previous.owner_id = ledger.owner_id AND previous.id = ledger.rule_id
  GROUP BY ledger.owner_id, ledger.metric_date
), new_bonus AS (
  SELECT owner_id, metric_date, sum(awarded_points)::integer AS points
  FROM bike_bonus_new_contributions GROUP BY owner_id, metric_date
)
SELECT dm.owner_id, dm.metric_date, coalesce(old_bonus.points, 0) AS old_points,
  coalesce(new_bonus.points, 0) AS new_points
FROM daily_metrics dm
LEFT JOIN old_bonus ON old_bonus.owner_id = dm.owner_id AND old_bonus.metric_date = dm.metric_date
LEFT JOIN new_bonus ON new_bonus.owner_id = dm.owner_id AND new_bonus.metric_date = dm.metric_date
WHERE dm.score_status <> 'imported'
  AND (coalesce(old_bonus.points, 0) <> 0 OR coalesce(new_bonus.points, 0) <> 0);

DELETE FROM score_ledger ledger
USING bike_bonus_previous_rules previous, bike_bonus_affected_days affected
WHERE ledger.owner_id = previous.owner_id AND ledger.rule_id = previous.id
  AND ledger.owner_id = affected.owner_id AND ledger.metric_date = affected.metric_date;

INSERT INTO score_ledger (owner_id, metric_date, activity_id, rule_id, points, reason, calculation_json)
SELECT contribution.owner_id, contribution.metric_date, contribution.activity_id,
  contribution.rule_id, contribution.awarded_points,
  contribution.name || ': ' || contribution.speed::text || ' km/h gte '
    || contribution.threshold_value::text || ' km/h; ' || contribution.multiplier::text
    || ' completed 10 km blocks × ' || contribution.points::text || ' = ' || contribution.awarded_points::text,
  jsonb_build_object(
    'ruleKind', 'achievement', 'classification', 'bonus', 'activityType', 'bike',
    'metric', 'avg_speed_kmh', 'metricUnit', 'km/h', 'metricValue', contribution.speed,
    'thresholdComparisonValue', contribution.speed, 'thresholdOperator', 'gte',
    'thresholdValue', contribution.threshold_value, 'thresholdUnit', 'km/h',
    'eligibilityRounding', NULL, 'configuredPoints', contribution.points,
    'achievementGroup', NULL, 'pointsMultiplier', 'completed_10k_blocks',
    'multiplierInputValue', contribution.distance_m, 'multiplierValue', contribution.multiplier,
    'awardedPoints', contribution.awarded_points,
    'auxiliaryConditions', jsonb_build_array(
      jsonb_build_object('metric','distance_m','operator','gte','expected',10000,'actual',contribution.distance_m,'passed',true)
    ),
    'validFrom', contribution.valid_from::text, 'validTo', contribution.valid_to::text,
    'priority', contribution.priority
  )
FROM bike_bonus_new_contributions contribution
JOIN bike_bonus_affected_days affected ON affected.owner_id = contribution.owner_id
  AND affected.metric_date = contribution.metric_date;

UPDATE daily_metrics dm SET
  bonus_points = dm.bonus_points - affected.old_points + affected.new_points,
  total_points = dm.total_points - affected.old_points + affected.new_points,
  recomputed_at = now()
FROM bike_bonus_affected_days affected
WHERE dm.owner_id = affected.owner_id AND dm.metric_date = affected.metric_date;

WITH snapshots AS (
  INSERT INTO daily_score_snapshots (
    owner_id, metric_date, score_status, base_points, bonus_points, total_points,
    facts_json, ledger_json, source_record_id, trigger
  )
  SELECT dm.owner_id, dm.metric_date, dm.score_status, dm.base_points,
    dm.bonus_points, dm.total_points,
    coalesce(previous.facts_json, '{}'::jsonb) || jsonb_build_object(
      'metricDate', dm.metric_date::text, 'steps', dm.steps, 'runM', dm.run_m,
      'bikeM', dm.bike_m, 'swimM', dm.swim_m, 'workoutPoints', dm.workout_points
    ),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
      'metricDate', ledger.metric_date::text, 'activityId', ledger.activity_id,
      'ruleId', ledger.rule_id, 'points', ledger.points, 'reason', ledger.reason,
      'calculationJson', ledger.calculation_json
    ) ORDER BY ledger.created_at, ledger.id) FROM score_ledger ledger
      WHERE ledger.owner_id = dm.owner_id AND ledger.metric_date = dm.metric_date), '[]'::jsonb),
    dm.source_record_id, 'rule_recomputation'
  FROM daily_metrics dm
  JOIN bike_bonus_affected_days affected ON affected.owner_id = dm.owner_id AND affected.metric_date = dm.metric_date
  LEFT JOIN daily_score_snapshots previous ON previous.owner_id = dm.owner_id AND previous.id = dm.score_snapshot_id
  RETURNING owner_id, metric_date, id
)
UPDATE daily_metrics dm SET score_snapshot_id = snapshots.id
FROM snapshots WHERE snapshots.owner_id = dm.owner_id AND snapshots.metric_date = dm.metric_date;
