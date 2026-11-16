-- Synthetic disposable fixture: migrate through V148, load, then migrate V149.
INSERT INTO accounts(id, display_name, status) VALUES
 ('22222222-2222-4222-8222-222222222222', 'Synthetic second owner', 'active'),
 ('33333333-3333-4333-8333-333333333333', 'Synthetic custom owner', 'active'),
 ('44444444-4444-4444-8444-444444444444', 'Synthetic ranged owner', 'active');
DO $$ DECLARE account uuid; BEGIN
 FOR account IN SELECT id FROM accounts LOOP
  PERFORM set_config('sportos.account_id', account::text, false);
  PERFORM sportos_seed_account_rules(account);
 END LOOP;
END $$;
UPDATE scoring_rules SET coefficient = 999 WHERE owner_id = '33333333-3333-4333-8333-333333333333' AND code = 'bike.km.default';
UPDATE scoring_rules SET valid_to = '2094-01-02'
WHERE owner_id = '44444444-4444-4444-8444-444444444444' AND code = 'bike.km.default';
INSERT INTO scoring_rules(owner_id, code, version, name, activity_type, rule_kind, metric, coefficient, valid_from, priority, enabled)
SELECT owner_id, code, version + 1, name, activity_type, rule_kind, metric, coefficient, '2094-01-03', priority, true
FROM scoring_rules WHERE owner_id = '44444444-4444-4444-8444-444444444444' AND code = 'bike.km.default';
CREATE TABLE indoor_bike_cases AS
SELECT owner_id, DATE '2094-01-01' + offset_days AS metric_date, km, rate, formula,
  cases.status, expected_points
FROM accounts CROSS JOIN (VALUES
 (0, 10.0, 700, 'Excel: indoor bike km × 700', 'calculated', 7500),
 (1, 10.001, 700, 'Excel: indoor bike km × 700', 'manual', 7501),
 (2, 10.0, 600, 'Excel: outdoor bike km × 600', 'calculated', 6000),
 (3, 10.0, 650, 'Excel activity coefficient', 'calculated', 6500),
 (4, 10.0, 700, 'Excel: indoor bike km × 700', 'imported', 7000)
) cases(offset_days, km, rate, formula, status, expected_points)
CROSS JOIN LATERAL (SELECT accounts.id AS owner_id) owner;
INSERT INTO daily_metrics(owner_id, metric_date, bike_m, base_points, bonus_points, total_points, score_status, excel_all_points)
SELECT owner_id, metric_date, km * 1000, round(km * rate), 0, round(km * rate), status, CASE WHEN status = 'imported' THEN round(km * rate) ELSE NULL END FROM indoor_bike_cases;
INSERT INTO score_ledger(owner_id, metric_date, rule_id, points, reason, calculation_json)
SELECT c.owner_id, c.metric_date, r.id, round(c.km * c.rate), 'Synthetic prior bike contribution',
 jsonb_build_object('classification', 'base', 'ruleKind', 'coefficient', 'activityType', 'bike',
  'metric', 'distance_km', 'metricUnit', 'km', 'metricValue', c.km, 'coefficient', c.rate,
  'configuredCoefficient', 650, 'appliedCoefficient', c.rate, 'sourceFormula', c.formula,
  'coefficientSource', 'confirmed_workbook_subtype_semantics', 'rawPoints', c.km * c.rate,
  'roundedPoints', round(c.km * c.rate), 'rounding', 'nearest_integer_per_rule')
FROM indoor_bike_cases c JOIN scoring_rules r ON r.owner_id = c.owner_id AND r.code = 'bike.km.default' AND r.enabled
 AND c.metric_date >= r.valid_from AND (r.valid_to IS NULL OR c.metric_date <= r.valid_to);
WITH snapshots AS (
 INSERT INTO daily_score_snapshots(owner_id, metric_date, score_status, base_points, bonus_points, total_points, facts_json, ledger_json, trigger)
 SELECT d.owner_id, d.metric_date, d.score_status, d.base_points, d.bonus_points, d.total_points,
  jsonb_build_object('metricDate', d.metric_date::text, 'bikeM', d.bike_m, 'bikeIndoorM', d.bike_m,
    'stepsCalculation', jsonb_build_object('source', 'stored', 'resolvedSteps', 0)),
  '[]'::jsonb, 'legacy_migration' FROM daily_metrics d RETURNING *
) UPDATE daily_metrics d SET score_snapshot_id = s.id FROM snapshots s WHERE s.owner_id = d.owner_id AND s.metric_date = d.metric_date;
CREATE TABLE indoor_bike_baseline AS SELECT
 (SELECT jsonb_agg(to_jsonb(s)) FROM daily_score_snapshots s) AS snapshots,
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY owner_id, metric_date) FROM daily_metrics d WHERE score_status = 'imported') AS imported,
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM score_ledger l JOIN daily_metrics d USING(owner_id,metric_date) WHERE d.score_status = 'imported') AS imported_ledger,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM scoring_rules r WHERE code = 'bike.km.default') AS old_rules;
