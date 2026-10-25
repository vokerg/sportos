-- Synthetic fixture for a disposable database migrated through V140 only.
INSERT INTO accounts(id,display_name,status) VALUES
 ('22222222-2222-4222-8222-222222222222','Synthetic bike owner','active'),
 ('33333333-3333-4333-8333-333333333333','Synthetic ranged bike owner','active'),
 ('44444444-4444-4444-8444-444444444444','Synthetic custom bike owner','active');
DO $$ DECLARE account uuid; BEGIN
 FOR account IN SELECT id FROM accounts LOOP
  PERFORM set_config('sportos.account_id',account::text,false);
  PERFORM sportos_seed_account_rules(account);
 END LOOP;
END $$;
UPDATE scoring_rules SET valid_to='2093-12-31'
 WHERE owner_id='33333333-3333-4333-8333-333333333333' AND enabled AND code='bike.10k.easy.bonus';
INSERT INTO scoring_rules(owner_id,code,version,supersedes_rule_id,name,activity_type,rule_kind,metric,threshold_operator,threshold_value,threshold_unit,points,valid_from,priority,enabled)
SELECT owner_id,code,version+1,id,name,activity_type,rule_kind,metric,threshold_operator,threshold_value,threshold_unit,points,'2094-01-01',priority,true
FROM scoring_rules WHERE owner_id='33333333-3333-4333-8333-333333333333' AND enabled AND code='bike.10k.easy.bonus';
-- A customized family is left entirely alone.
UPDATE scoring_rules SET points=4321
 WHERE owner_id='44444444-4444-4444-8444-444444444444' AND enabled AND code='bike.10k.easy.bonus';
CREATE TABLE bike_blocks_upgrade_cases AS
SELECT owner_id, DATE '2094-01-01'+offset_days AS metric_date, distance_m,
 speed_kmh, score_status, expected_bonus, sessions
FROM (VALUES ('00000000-0000-4000-8000-000000000001'::uuid),
 ('22222222-2222-4222-8222-222222222222'::uuid),
 ('33333333-3333-4333-8333-333333333333'::uuid),
 ('44444444-4444-4444-8444-444444444444'::uuid)) owners(owner_id)
CROSS JOIN (VALUES
 (0,30000,24,'calculated',3000,1),
 (1,30700,24,'calculated',3000,1),
 (2,10000,19.9,'calculated',1000,1),
 (3,9999.9,24,'calculated',0,1),
 (4,19999.9,24,'calculated',1000,1),
 (5,20000,24,'calculated',2000,1),
 (6,29999.9,24,'calculated',2000,1),
 (7,30000,19.89,'calculated',0,1),
 (8,30000,NULL,'calculated',0,1),
 (9,30000,24,'imported',0,1),
 (10,30000,24,'manual',3000,1),
 (11,15000,24,'calculated',2000,2),
 (12,5000,24,'calculated',0,2)
) cases(offset_days,distance_m,speed_kmh,score_status,expected_bonus,sessions);
INSERT INTO activities(owner_id,source,activity_date,activity_type,distance_m,avg_speed_mps)
SELECT owner_id,'strava',metric_date,'bike',distance_m,speed_kmh/3.6
FROM bike_blocks_upgrade_cases CROSS JOIN LATERAL generate_series(1,sessions);
INSERT INTO daily_metrics(owner_id,metric_date,bike_m,base_points,bonus_points,total_points,score_status,excel_all_points)
SELECT owner_id,metric_date,distance_m*sessions,7500,777,8277,score_status,
 CASE WHEN score_status='imported' THEN 8277 END FROM bike_blocks_upgrade_cases;
INSERT INTO score_ledger(owner_id,metric_date,points,reason,calculation_json)
SELECT owner_id,metric_date,7500,'Synthetic base','{"classification":"base"}' FROM daily_metrics;
INSERT INTO score_ledger(owner_id,metric_date,points,reason,calculation_json)
SELECT owner_id,metric_date,777,'Synthetic unrelated bonus','{"classification":"bonus"}' FROM daily_metrics;
INSERT INTO score_ledger(owner_id,metric_date,activity_id,rule_id,points,reason,calculation_json)
SELECT a.owner_id,a.activity_date,a.id,r.id,r.points,'Synthetic prior bike','{"classification":"bonus"}'
FROM activities a JOIN daily_metrics dm ON dm.owner_id=a.owner_id AND dm.metric_date=a.activity_date
JOIN scoring_rules r ON r.owner_id=a.owner_id AND r.enabled AND r.code='bike.10k.easy.bonus'
 AND a.activity_date>=r.valid_from AND (r.valid_to IS NULL OR a.activity_date<=r.valid_to)
WHERE a.distance_m>=10000 AND a.avg_speed_mps*3.6>=r.threshold_value AND dm.score_status<>'imported';
UPDATE daily_metrics dm SET bonus_points=(SELECT sum(l.points)-7500 FROM score_ledger l WHERE l.owner_id=dm.owner_id AND l.metric_date=dm.metric_date),
 total_points=(SELECT sum(l.points) FROM score_ledger l WHERE l.owner_id=dm.owner_id AND l.metric_date=dm.metric_date);
WITH snapshots AS (
 INSERT INTO daily_score_snapshots(owner_id,metric_date,score_status,base_points,bonus_points,total_points,facts_json,ledger_json,trigger)
 SELECT dm.owner_id,dm.metric_date,dm.score_status,dm.base_points,dm.bonus_points,dm.total_points,
 '{"bonusPoints":0,"stepsCalculation":{"source":"stored","resolvedSteps":0}}',
 coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM score_ledger l WHERE l.owner_id=dm.owner_id AND l.metric_date=dm.metric_date),'[]'),
 'legacy_migration' FROM daily_metrics dm RETURNING id,owner_id,metric_date
) UPDATE daily_metrics dm SET score_snapshot_id=s.id FROM snapshots s WHERE s.owner_id=dm.owner_id AND s.metric_date=dm.metric_date;
CREATE TABLE bike_blocks_upgrade_baseline AS SELECT
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM activities a) AS activities,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM daily_score_snapshots s) AS snapshots,
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.owner_id,d.metric_date) FROM daily_metrics d WHERE d.score_status='imported') AS imported,
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM score_ledger l LEFT JOIN scoring_rules r ON r.id=l.rule_id
 WHERE r.code IS DISTINCT FROM 'bike.10k.easy.bonus') AS preserved_ledger,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM scoring_rules r WHERE r.enabled AND r.code='bike.10k.easy.bonus' AND r.owner_id<>'44444444-4444-4444-8444-444444444444') AS prior_rules,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM scoring_rules r WHERE r.owner_id='44444444-4444-4444-8444-444444444444') AS custom_rules,
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.metric_date) FROM daily_metrics d WHERE d.owner_id='44444444-4444-4444-8444-444444444444') AS custom_days;
