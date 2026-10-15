-- Synthetic fixture for a disposable database migrated through V135 only.
INSERT INTO accounts(id,display_name,status) VALUES
 ('22222222-2222-4222-8222-222222222222','Synthetic moving swim owner','active'),
 ('33333333-3333-4333-8333-333333333333','Synthetic ranged swim owner','active'),
 ('44444444-4444-4444-8444-444444444444','Synthetic custom swim owner','active');
DO $$ DECLARE account uuid; BEGIN
 FOR account IN SELECT id FROM accounts LOOP
  PERFORM set_config('sportos.account_id',account::text,false);
  PERFORM sportos_seed_account_rules(account);
 END LOOP;
END $$;
-- Disjoint ranges must survive replacement, including supersession per UUID.
UPDATE scoring_rules SET valid_to='2093-12-31'
 WHERE owner_id='33333333-3333-4333-8333-333333333333' AND enabled AND achievement_group='swim.pace.1k';
INSERT INTO scoring_rules(owner_id,code,version,supersedes_rule_id,name,activity_type,rule_kind,metric,threshold_operator,threshold_value,threshold_unit,points,achievement_group,valid_from,priority,enabled)
SELECT owner_id,code,version+1,id,name,activity_type,rule_kind,metric,threshold_operator,threshold_value,threshold_unit,points,achievement_group,'2094-01-01',priority,true
FROM scoring_rules WHERE owner_id='33333333-3333-4333-8333-333333333333' AND enabled AND achievement_group='swim.pace.1k';
-- One customized tier preserves the entire account's group authority.
UPDATE scoring_rules SET points=4321
 WHERE owner_id='44444444-4444-4444-8444-444444444444' AND enabled AND code='swim.1k.sub19.bonus';
CREATE TABLE swim_moving_upgrade_cases AS
SELECT owner_id, DATE '2094-01-01'+offset_days AS metric_date, distance_m,
 duration_s, moving_time_s, score_status, expected_bonus
FROM (VALUES ('00000000-0000-4000-8000-000000000001'::uuid),
 ('22222222-2222-4222-8222-222222222222'::uuid),
 ('33333333-3333-4333-8333-333333333333'::uuid)) owners(owner_id)
CROSS JOIN (VALUES
 (0,1000,1202,1192,'calculated',2000),
 (1,1000,1202,1200,'calculated',0),
 (2,1000,1202,1199,'calculated',2000),
 (3,1000,1202,1170,'calculated',2000),
 (4,1000,1202,1169,'calculated',3000),
 (5,1000,1202,1140,'calculated',3000),
 (6,1000,1202,1139,'calculated',4000),
 (7,1000,1202,1110,'calculated',4000),
 (8,1000,1202,1109,'calculated',5000),
 (9,2000,2402,2266,'calculated',4000),
 (10,999,1100,1000,'calculated',0),
 (11,1000,1100,NULL,'calculated',0),
 (12,1000,1100,0,'calculated',0),
 (13,1000,NULL,1139,'calculated',4000),
 (14,1000,1202,1192,'imported',0),
 (15,1000,1202,1192,'manual',2000)
) cases(offset_days,distance_m,duration_s,moving_time_s,score_status,expected_bonus);
INSERT INTO activities(owner_id,source,activity_date,activity_type,distance_m,duration_s,moving_time_s)
SELECT owner_id,'strava',metric_date,'swim',distance_m,duration_s,moving_time_s FROM swim_moving_upgrade_cases;
INSERT INTO daily_metrics(owner_id,metric_date,swim_m,base_points,bonus_points,total_points,score_status,excel_all_points)
SELECT owner_id,metric_date,distance_m,7500,777,8277,score_status,
 CASE WHEN score_status='imported' THEN 8277 END FROM swim_moving_upgrade_cases;
INSERT INTO score_ledger(owner_id,metric_date,rule_id,points,reason,calculation_json)
SELECT dm.owner_id,dm.metric_date,sr.id,7500,'Synthetic base','{"classification":"base"}'
FROM daily_metrics dm JOIN scoring_rules sr ON sr.owner_id=dm.owner_id AND sr.code='swim.m.default' AND sr.enabled;
INSERT INTO score_ledger(owner_id,metric_date,points,reason,calculation_json)
SELECT owner_id,metric_date,777,'Synthetic unrelated bonus','{"classification":"bonus"}' FROM daily_metrics;
INSERT INTO score_ledger(owner_id,metric_date,activity_id,rule_id,points,reason,calculation_json)
SELECT a.owner_id,a.activity_date,a.id,tier.id,tier.points,'Synthetic prior swim','{"classification":"bonus"}'
FROM activities a
JOIN daily_metrics dm ON dm.owner_id=a.owner_id AND dm.metric_date=a.activity_date
JOIN LATERAL (SELECT sr.* FROM scoring_rules sr WHERE sr.owner_id=a.owner_id AND sr.enabled
 AND sr.achievement_group='swim.pace.1k' AND a.activity_date>=sr.valid_from
 AND (sr.valid_to IS NULL OR a.activity_date<=sr.valid_to)
 AND a.duration_s/(NULLIF(a.distance_m,0)/1000.0)<sr.threshold_value
 ORDER BY sr.points DESC LIMIT 1) tier ON true
WHERE a.distance_m>=1000 AND a.duration_s>0 AND dm.score_status<>'imported';
UPDATE daily_metrics dm SET bonus_points=(SELECT sum(l.points)-7500 FROM score_ledger l WHERE l.owner_id=dm.owner_id AND l.metric_date=dm.metric_date),
 total_points=(SELECT sum(l.points) FROM score_ledger l WHERE l.owner_id=dm.owner_id AND l.metric_date=dm.metric_date);
WITH snapshots AS (
 INSERT INTO daily_score_snapshots(owner_id,metric_date,score_status,base_points,bonus_points,total_points,facts_json,ledger_json,trigger)
 SELECT dm.owner_id,dm.metric_date,dm.score_status,dm.base_points,dm.bonus_points,dm.total_points,
 '{"bonusPoints":0,"stepsCalculation":{"source":"stored","resolvedSteps":0}}',
 coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM score_ledger l WHERE l.owner_id=dm.owner_id AND l.metric_date=dm.metric_date),'[]'),
 'legacy_migration' FROM daily_metrics dm RETURNING id,owner_id,metric_date
) UPDATE daily_metrics dm SET score_snapshot_id=s.id FROM snapshots s WHERE s.owner_id=dm.owner_id AND s.metric_date=dm.metric_date;
CREATE TABLE swim_moving_upgrade_baseline AS SELECT
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM activities a) AS activities,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM daily_score_snapshots s) AS snapshots,
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.owner_id,d.metric_date) FROM daily_metrics d WHERE d.score_status='imported') AS imported,
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM score_ledger l LEFT JOIN scoring_rules r ON r.id=l.rule_id
 WHERE r.achievement_group IS DISTINCT FROM 'swim.pace.1k') AS preserved_ledger,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM scoring_rules r WHERE r.enabled AND r.achievement_group='swim.pace.1k' AND r.owner_id<>'44444444-4444-4444-8444-444444444444') AS prior_rules,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM scoring_rules r WHERE r.owner_id='44444444-4444-4444-8444-444444444444') AS custom_rules;
