-- One highest moving-pace tier per canonical swim >= 1 km. No distance
-- multiplier or favourable rounding. Preserve rule UUID/snapshot history.
LOCK TABLE scoring_rules, daily_metrics, score_ledger IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE swim_bonus_previous_rules ON COMMIT DROP AS
SELECT sr.* FROM scoring_rules sr
JOIN (VALUES
  ('swim.1k.sub20.bonus', 1200, 2000, 90),
  ('swim.1k.sub19m30.bonus', 1170, 3000, 91),
  ('swim.1k.sub19.bonus', 1140, 4000, 92),
  ('swim.1k.sub18m30.bonus', 1110, 5000, 93)
) tier(code, threshold, points, priority)
  ON sr.code = tier.code AND sr.threshold_value = tier.threshold
  AND sr.points = tier.points AND sr.priority = tier.priority
WHERE sr.enabled AND sr.activity_type = 'swim' AND sr.activity_subtype IS NULL
  AND sr.rule_kind = 'achievement' AND sr.metric = 'pace_s_per_km'
  AND sr.threshold_operator = 'lt' AND sr.threshold_unit = 's/km'
  AND sr.achievement_group = 'swim.pace.1k' AND sr.points_multiplier IS NULL;
DELETE FROM swim_bonus_previous_rules previous
WHERE EXISTS (SELECT 1 FROM scoring_rules custom
  WHERE custom.owner_id = previous.owner_id AND custom.enabled
    AND custom.achievement_group = 'swim.pace.1k'
    AND NOT EXISTS (SELECT 1 FROM swim_bonus_previous_rules standard WHERE standard.id = custom.id));
-- Accounts with customized group definitions retain their existing authority.
UPDATE scoring_rules sr SET enabled = false
FROM swim_bonus_previous_rules previous
WHERE sr.owner_id = previous.owner_id AND sr.id = previous.id;

CREATE TEMP TABLE swim_bonus_new_rules ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO scoring_rules (
    owner_id, code, version, supersedes_rule_id, name, activity_type, rule_kind,
    metric, threshold_operator, threshold_value, threshold_unit, points,
    achievement_group, valid_from, valid_to, priority, enabled, description
  )
  SELECT previous.owner_id, previous.code,
    (SELECT max(existing.version) FROM scoring_rules existing
      WHERE existing.owner_id = previous.owner_id AND existing.code = previous.code)
      + row_number() OVER (PARTITION BY previous.owner_id, previous.code ORDER BY previous.valid_from, previous.id)::integer,
    previous.id, replace(previous.name, 'Swim pace', 'Swim moving pace'),
    'swim', 'achievement', 'moving_pace_s_per_km', 'lt', previous.threshold_value,
    's/km', previous.points, 'swim.pace.1k', previous.valid_from, previous.valid_to,
    previous.priority, true,
    'One highest matching swim.pace.1k bonus per canonical swim of at least 1000 meters; canonical moving seconds per kilometer strictly below threshold. Missing or invalid moving time earns no bonus. No rounding, elapsed fallback or distance multiplier.'
  FROM swim_bonus_previous_rules previous
  RETURNING *
) SELECT * FROM inserted;
-- The existing account seed function copies the versioned legacy-account
-- catalog, including these new tiers and disabled immutable prior definitions.

CREATE TEMP TABLE swim_bonus_new_contributions ON COMMIT DROP AS
SELECT activity.owner_id, activity.activity_date AS metric_date,
  activity.id AS activity_id, activity.distance_m, activity.moving_time_s,
  activity.moving_time_s / (activity.distance_m / 1000.0) AS pace, tier.*
FROM activities activity
JOIN LATERAL (
  SELECT rule.id AS rule_id, rule.points, rule.name, rule.threshold_value,
    rule.achievement_group, rule.valid_from, rule.valid_to, rule.priority
  FROM swim_bonus_new_rules rule
  WHERE rule.owner_id = activity.owner_id
    AND activity.activity_date >= rule.valid_from
    AND (rule.valid_to IS NULL OR activity.activity_date <= rule.valid_to)
    AND activity.moving_time_s / (NULLIF(activity.distance_m, 0) / 1000.0) < rule.threshold_value
  ORDER BY rule.points DESC, rule.priority ASC, rule.code ASC
  LIMIT 1
) tier ON true
WHERE activity.activity_type = 'swim' AND activity.distance_m >= 1000
  AND activity.moving_time_s > 0 AND activity.moving_time_s < 'Infinity'::double precision
  AND activity.distance_m < 'Infinity'::double precision;

CREATE TEMP TABLE swim_bonus_affected_days ON COMMIT DROP AS
WITH old_bonus AS (
  SELECT ledger.owner_id, ledger.metric_date, sum(ledger.points)::integer AS points
  FROM score_ledger ledger JOIN swim_bonus_previous_rules previous
    ON previous.owner_id = ledger.owner_id AND previous.id = ledger.rule_id
  GROUP BY ledger.owner_id, ledger.metric_date
), new_bonus AS (
  SELECT owner_id, metric_date, sum(points)::integer AS points
  FROM swim_bonus_new_contributions GROUP BY owner_id, metric_date
)
SELECT dm.owner_id, dm.metric_date, coalesce(old_bonus.points, 0) AS old_points,
  coalesce(new_bonus.points, 0) AS new_points
FROM daily_metrics dm
LEFT JOIN old_bonus ON old_bonus.owner_id = dm.owner_id AND old_bonus.metric_date = dm.metric_date
LEFT JOIN new_bonus ON new_bonus.owner_id = dm.owner_id AND new_bonus.metric_date = dm.metric_date
WHERE dm.score_status <> 'imported'
  AND (coalesce(old_bonus.points, 0) <> 0 OR coalesce(new_bonus.points, 0) <> 0);

DELETE FROM score_ledger ledger
USING swim_bonus_previous_rules previous, swim_bonus_affected_days affected
WHERE ledger.owner_id = previous.owner_id AND ledger.rule_id = previous.id
  AND ledger.owner_id = affected.owner_id AND ledger.metric_date = affected.metric_date;

INSERT INTO score_ledger (owner_id, metric_date, activity_id, rule_id, points, reason, calculation_json)
SELECT contribution.owner_id, contribution.metric_date, contribution.activity_id,
  contribution.rule_id, contribution.points,
  contribution.name || ': ' || contribution.pace::text || ' s/km lt '
    || contribution.threshold_value::text || ' s/km; +' || contribution.points::text,
  jsonb_build_object(
    'ruleKind', 'achievement', 'classification', 'bonus', 'activityType', 'swim',
    'metric', 'moving_pace_s_per_km', 'metricUnit', 's/km', 'metricValue', contribution.pace,
    'thresholdComparisonValue', contribution.pace, 'thresholdOperator', 'lt',
    'thresholdValue', contribution.threshold_value, 'thresholdUnit', 's/km',
    'eligibilityRounding', NULL, 'configuredPoints', contribution.points,
    'achievementGroup', contribution.achievement_group, 'pointsMultiplier', NULL,
    'multiplierInputValue', NULL, 'multiplierValue', 1, 'awardedPoints', contribution.points,
    'auxiliaryConditions', jsonb_build_array(
      jsonb_build_object('metric','distance_m','operator','gte','expected',1000,'actual',contribution.distance_m,'passed',true),
      jsonb_build_object('metric','moving_time_s','operator','gt','expected',0,'actual',contribution.moving_time_s,'passed',true)
    ),
    'validFrom', contribution.valid_from::text, 'validTo', contribution.valid_to::text,
    'priority', contribution.priority
  )
FROM swim_bonus_new_contributions contribution
JOIN swim_bonus_affected_days affected ON affected.owner_id = contribution.owner_id
  AND affected.metric_date = contribution.metric_date;

UPDATE daily_metrics dm SET
  bonus_points = dm.bonus_points - affected.old_points + affected.new_points,
  total_points = dm.total_points - affected.old_points + affected.new_points,
  recomputed_at = now()
FROM swim_bonus_affected_days affected
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
  JOIN swim_bonus_affected_days affected ON affected.owner_id = dm.owner_id AND affected.metric_date = dm.metric_date
  LEFT JOIN daily_score_snapshots previous ON previous.owner_id = dm.owner_id AND previous.id = dm.score_snapshot_id
  RETURNING owner_id, metric_date, id
)
UPDATE daily_metrics dm SET score_snapshot_id = snapshots.id
FROM snapshots WHERE snapshots.owner_id = dm.owner_id AND snapshots.metric_date = dm.metric_date;
