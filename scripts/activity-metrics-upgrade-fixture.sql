-- Disposable V128 test database only; synthetic public fixture, no private data.
SET sportos.account_id='00000000-0000-4000-8000-000000000001';
INSERT INTO activities(id,source,activity_date,activity_type,subtype,distance_m,duration_s,moving_time_s)
VALUES ('11111111-1111-4111-8111-111111111112','manual','2095-05-01','run','outdoor',10020,3100,3000);
INSERT INTO daily_metrics(metric_date,steps,run_m,total_points,base_points,bonus_points)
VALUES ('2095-05-01',12345,10020,1234,1234,0);
INSERT INTO score_ledger(metric_date,activity_id,rule_id,points,reason,calculation_json)
SELECT '2095-05-01','11111111-1111-4111-8111-111111111112',id,1234,'Synthetic upgrade test','{"distance":10020}'::jsonb
FROM scoring_rules WHERE code='run.km.default';
CREATE TABLE activity_metric_upgrade_baseline AS SELECT
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM activities a) AS activities,
  (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.owner_id,d.metric_date) FROM daily_metrics d) AS daily,
  (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM score_ledger l) AS ledger,
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM daily_score_snapshots s) AS snapshots,
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM performance_events p) AS performance;
