-- Version the indoor bike base coefficient without changing historical UUID semantics.
LOCK TABLE scoring_rules, daily_metrics, score_ledger IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE scoring_rules ADD COLUMN indoor_bike_coefficient numeric;
ALTER TABLE scoring_rules ADD CONSTRAINT chk_indoor_bike_coefficient CHECK (
  indoor_bike_coefficient IS NULL OR (
    code = 'bike.km.default' AND activity_type = 'bike' AND rule_kind = 'coefficient'
    AND metric = 'distance_km' AND indoor_bike_coefficient > 0
    AND indoor_bike_coefficient < 'Infinity'::numeric
  )
);

CREATE TEMP TABLE indoor_bike_previous_rules ON COMMIT DROP AS
SELECT * FROM scoring_rules
WHERE enabled AND code = 'bike.km.default' AND activity_type = 'bike'
  AND rule_kind = 'coefficient' AND metric = 'distance_km' AND coefficient = 650
  AND indoor_bike_coefficient IS NULL;
-- A customized enabled family remains entirely under its existing authority.
DELETE FROM indoor_bike_previous_rules previous WHERE EXISTS (
  SELECT 1 FROM scoring_rules custom WHERE custom.owner_id = previous.owner_id
    AND custom.enabled AND custom.code = previous.code
    AND NOT EXISTS (SELECT 1 FROM indoor_bike_previous_rules standard WHERE standard.id = custom.id)
);
UPDATE scoring_rules rule SET enabled = false
FROM indoor_bike_previous_rules previous WHERE rule.id = previous.id AND rule.owner_id = previous.owner_id;

CREATE TEMP TABLE indoor_bike_new_rules ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO scoring_rules (owner_id, code, version, supersedes_rule_id, name,
    activity_type, rule_kind, metric, coefficient, indoor_bike_coefficient,
    valid_from, valid_to, priority, enabled, description)
  SELECT previous.owner_id, previous.code,
    (SELECT max(existing.version) FROM scoring_rules existing
      WHERE existing.owner_id = previous.owner_id AND existing.code = previous.code)
      + row_number() OVER (PARTITION BY previous.owner_id, previous.code ORDER BY previous.valid_from, previous.id)::integer,
    previous.id, previous.name, previous.activity_type, previous.rule_kind, previous.metric,
    previous.coefficient, 750, previous.valid_from, previous.valid_to, previous.priority, true,
    'Base bike points: indoor km times 750; outdoor km times 600; unspecified km times configured coefficient. Round each contribution to the nearest whole point. Historical workbook indoor coefficient was 700/km. Speed bonuses remain separate.'
  FROM indoor_bike_previous_rules previous RETURNING *
) SELECT * FROM inserted;

-- Use retained calculation inputs, including manual daily distance aggregates.
-- No provider fetch, canonical rewrite or inference from an aggregate distance.
CREATE TEMP TABLE indoor_bike_contributions ON COMMIT DROP AS
SELECT ledger.id, ledger.owner_id, ledger.metric_date, ledger.points AS old_points,
  rule.id AS rule_id,
  CASE WHEN ledger.calculation_json->>'sourceFormula' = 'Excel: indoor bike km × 700'
      AND ledger.calculation_json->>'appliedCoefficient' = '700'
    THEN round((ledger.calculation_json->>'metricValue')::numeric * 750)::integer
    ELSE ledger.points END AS new_points,
  ledger.calculation_json->>'sourceFormula' = 'Excel: indoor bike km × 700'
    AND ledger.calculation_json->>'appliedCoefficient' = '700' AS indoor
FROM score_ledger ledger
JOIN indoor_bike_new_rules rule ON rule.owner_id = ledger.owner_id AND rule.supersedes_rule_id = ledger.rule_id
JOIN daily_metrics dm ON dm.owner_id = ledger.owner_id AND dm.metric_date = ledger.metric_date
WHERE dm.score_status <> 'imported';

CREATE TEMP TABLE indoor_bike_affected_days ON COMMIT DROP AS
SELECT owner_id, metric_date, sum(new_points - old_points)::integer AS delta
FROM indoor_bike_contributions GROUP BY owner_id, metric_date;

UPDATE score_ledger ledger SET rule_id = contribution.rule_id, points = contribution.new_points,
  reason = CASE WHEN contribution.indoor THEN
    'Indoor bike: round(' || (ledger.calculation_json->>'metricValue') || ' km × 750) = ' || contribution.new_points
    ELSE ledger.reason END,
  calculation_json = CASE WHEN contribution.indoor THEN ledger.calculation_json || jsonb_build_object(
    'coefficient', 750, 'appliedCoefficient', 750,
    'rawPoints', (ledger.calculation_json->>'metricValue')::numeric * 750,
    'roundedPoints', contribution.new_points,
    'coefficientSource', 'versioned_rule_subtype_semantics', 'sourceFormula', 'Indoor bike km × 750'
  ) ELSE ledger.calculation_json END
FROM indoor_bike_contributions contribution
WHERE ledger.id = contribution.id AND ledger.owner_id = contribution.owner_id;

UPDATE daily_metrics dm SET base_points = dm.base_points + affected.delta,
  total_points = dm.total_points + affected.delta, recomputed_at = now()
FROM indoor_bike_affected_days affected
WHERE dm.owner_id = affected.owner_id AND dm.metric_date = affected.metric_date;

WITH snapshots AS (
  INSERT INTO daily_score_snapshots (owner_id, metric_date, score_status, base_points,
    bonus_points, total_points, facts_json, ledger_json, source_record_id, trigger)
  SELECT dm.owner_id, dm.metric_date, dm.score_status, dm.base_points, dm.bonus_points,
    dm.total_points, coalesce(previous.facts_json, '{}'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
      'metricDate', ledger.metric_date::text, 'activityId', ledger.activity_id,
      'ruleId', ledger.rule_id, 'points', ledger.points, 'reason', ledger.reason,
      'calculationJson', ledger.calculation_json
    ) ORDER BY ledger.created_at, ledger.id) FROM score_ledger ledger
      WHERE ledger.owner_id = dm.owner_id AND ledger.metric_date = dm.metric_date), '[]'::jsonb),
    dm.source_record_id, 'rule_recomputation'
  FROM daily_metrics dm JOIN indoor_bike_affected_days affected
    ON affected.owner_id = dm.owner_id AND affected.metric_date = dm.metric_date
  LEFT JOIN daily_score_snapshots previous ON previous.owner_id = dm.owner_id AND previous.id = dm.score_snapshot_id
  RETURNING owner_id, metric_date, id
)
UPDATE daily_metrics dm SET score_snapshot_id = snapshots.id
FROM snapshots WHERE snapshots.owner_id = dm.owner_id AND snapshots.metric_date = dm.metric_date;

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
    metric, coefficient, indoor_bike_coefficient, threshold_operator, threshold_value, threshold_unit,
    points, achievement_group, points_multiplier, valid_from, valid_to, priority,
    enabled, description, created_at
  )
  SELECT
    target_account_id, code, version, NULL, name, activity_type, rule_kind,
    metric, coefficient, indoor_bike_coefficient, threshold_operator, threshold_value, threshold_unit,
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
