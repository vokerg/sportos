-- Disposable V129 database only. All activity/day data below is synthetic.
SET sportos.account_id = '00000000-0000-4000-8000-000000000001';
INSERT INTO accounts(id, display_name, status) VALUES ('22222222-2222-4222-8222-222222222222','Synthetic swim owner','active');
SET sportos.account_id = '22222222-2222-4222-8222-222222222222';
SELECT sportos_seed_account_rules('22222222-2222-4222-8222-222222222222');

-- Exercise disjoint enabled legacy ranges and customized account authority.
INSERT INTO accounts(id,display_name,status) VALUES
  ('33333333-3333-4333-8333-333333333333','Synthetic ranged owner','active'),
  ('44444444-4444-4444-8444-444444444444','Synthetic custom owner','active');
SET sportos.account_id = '33333333-3333-4333-8333-333333333333';
SELECT sportos_seed_account_rules('33333333-3333-4333-8333-333333333333');
UPDATE scoring_rules SET valid_to='2093-12-31' WHERE owner_id=sportos_current_account_id() AND code='swim.1k.sub20.bonus';
INSERT INTO scoring_rules(owner_id,code,version,supersedes_rule_id,name,activity_type,rule_kind,metric,threshold_operator,threshold_value,threshold_unit,points,valid_from,priority,enabled)
SELECT owner_id,code,2,id,name,activity_type,rule_kind,metric,threshold_operator,threshold_value,threshold_unit,points,'2094-01-01',priority,true
FROM scoring_rules WHERE owner_id=sportos_current_account_id() AND code='swim.1k.sub20.bonus';
SET sportos.account_id = '44444444-4444-4444-8444-444444444444';
SELECT sportos_seed_account_rules('44444444-4444-4444-8444-444444444444');
UPDATE scoring_rules SET enabled=false WHERE owner_id=sportos_current_account_id() AND code='swim.1k.sub20.bonus';
INSERT INTO scoring_rules(owner_id,code,version,supersedes_rule_id,name,activity_type,rule_kind,metric,threshold_operator,threshold_value,threshold_unit,points,valid_from,priority,enabled)
SELECT owner_id,code,2,id,name,activity_type,rule_kind,metric,threshold_operator,threshold_value,threshold_unit,1250,valid_from,priority,true
FROM scoring_rules WHERE owner_id=sportos_current_account_id() AND code='swim.1k.sub20.bonus';

CREATE TABLE swim_bonus_upgrade_cases (
  owner_id uuid, metric_date date, distance_m numeric, duration_s integer,
  score_status text, expected_bonus integer, PRIMARY KEY(owner_id,metric_date)
);
INSERT INTO swim_bonus_upgrade_cases
SELECT owner_id, DATE '2094-01-01' + offset_days, distance_m, duration_s, score_status, expected_bonus
FROM (VALUES
  ('00000000-0000-4000-8000-000000000001'::uuid), ('22222222-2222-4222-8222-222222222222'::uuid), ('33333333-3333-4333-8333-333333333333'::uuid)
) owners(owner_id)
CROSS JOIN (VALUES
  (0,1000,1200,'calculated',0), (1,1000,1199,'calculated',2000),
  (2,1000,1170,'calculated',2000), (3,1000,1169,'calculated',3000),
  (4,1000,1140,'calculated',3000), (5,1000,1139,'calculated',4000),
  (6,1000,1110,'calculated',4000), (7,1000,1109,'calculated',5000),
  (8,1000,900,'calculated',5000), (9,2000,2266,'calculated',4000),
  (10,999,1000,'calculated',0), (11,1000,0,'calculated',0),
  (12,1000,NULL,'calculated',0), (13,1000,1139,'imported',0),
  (14,1000,1139,'manual',4000)
) cases(offset_days,distance_m,duration_s,score_status,expected_bonus);

INSERT INTO activities(owner_id,source,activity_date,activity_type,distance_m,duration_s)
SELECT owner_id,'manual',metric_date,'swim',distance_m,duration_s FROM swim_bonus_upgrade_cases;
INSERT INTO daily_metrics(owner_id,metric_date,swim_m,base_points,bonus_points,total_points,score_status,excel_all_points)
SELECT c.owner_id,c.metric_date,c.distance_m,7500,
  CASE WHEN c.score_status <> 'imported' AND c.distance_m >= 1000 AND c.duration_s < 1200 THEN 1000 ELSE 0 END,
  7500 + CASE WHEN c.score_status <> 'imported' AND c.distance_m >= 1000 AND c.duration_s < 1200 THEN 1000 ELSE 0 END,
  c.score_status, CASE WHEN c.score_status='imported' THEN 7500 ELSE NULL END FROM swim_bonus_upgrade_cases c;
INSERT INTO score_ledger(owner_id,metric_date,rule_id,points,reason,calculation_json)
SELECT dm.owner_id,dm.metric_date,sr.id,7500,'Synthetic preserved base','{"classification":"base"}'
FROM daily_metrics dm JOIN scoring_rules sr ON sr.owner_id=dm.owner_id AND sr.code='swim.m.default' AND sr.enabled;
INSERT INTO score_ledger(owner_id,metric_date,activity_id,rule_id,points,reason,calculation_json)
SELECT dm.owner_id,dm.metric_date,a.id,sr.id,1000,'Synthetic legacy swim bonus','{"classification":"bonus"}'
FROM daily_metrics dm JOIN activities a ON a.owner_id=dm.owner_id AND a.activity_date=dm.metric_date
JOIN scoring_rules sr ON sr.owner_id=dm.owner_id AND sr.code='swim.1k.sub20.bonus' AND sr.enabled AND dm.metric_date>=sr.valid_from AND (sr.valid_to IS NULL OR dm.metric_date<=sr.valid_to)
WHERE dm.bonus_points=1000;
WITH snapshots AS (
  INSERT INTO daily_score_snapshots(owner_id,metric_date,score_status,base_points,bonus_points,total_points,facts_json,ledger_json,trigger)
  SELECT dm.owner_id,dm.metric_date,dm.score_status,dm.base_points,dm.bonus_points,dm.total_points,
    jsonb_build_object('metricDate',dm.metric_date,'bonusPoints',0,'stepsCalculation',jsonb_build_object('source','stored','resolvedSteps',0)),
    coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM score_ledger l WHERE l.owner_id=dm.owner_id AND l.metric_date=dm.metric_date),'[]'),
    'legacy_migration' FROM daily_metrics dm RETURNING id,owner_id,metric_date
) UPDATE daily_metrics dm SET score_snapshot_id=s.id FROM snapshots s WHERE s.owner_id=dm.owner_id AND s.metric_date=dm.metric_date;
CREATE TABLE swim_bonus_upgrade_baseline AS SELECT
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM activities a) AS activities,
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM daily_score_snapshots s) AS snapshots,
  (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.owner_id,d.metric_date) FROM daily_metrics d WHERE d.score_status='imported') AS imported,
  (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM score_ledger l JOIN daily_metrics d ON d.owner_id=l.owner_id AND d.metric_date=l.metric_date WHERE d.score_status='imported' OR l.calculation_json->>'classification'='base') AS preserved_ledger,
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM scoring_rules r WHERE r.code='swim.1k.sub20.bonus' AND r.enabled AND r.points=1000) AS prior_rules,
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM scoring_rules r WHERE r.owner_id='44444444-4444-4444-8444-444444444444') AS custom_rules;
