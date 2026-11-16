-- Run after V149 on the disposable populated fixture, as the schema owner.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM indoor_bike_cases c JOIN daily_metrics d USING(owner_id,metric_date)
   WHERE d.total_points <> CASE WHEN c.owner_id = '33333333-3333-4333-8333-333333333333'
     THEN round(c.km * c.rate)::integer ELSE c.expected_points END
     OR d.base_points <> d.total_points OR d.bonus_points <> 0 OR d.score_status <> c.status)
 THEN RAISE EXCEPTION 'Indoor migration total/status mismatch'; END IF;
 IF (SELECT jsonb_agg(to_jsonb(d) ORDER BY owner_id,metric_date) FROM daily_metrics d WHERE score_status='imported')
   IS DISTINCT FROM (SELECT imported FROM indoor_bike_baseline)
 THEN RAISE EXCEPTION 'Imported authority changed'; END IF;
 IF (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM score_ledger l JOIN daily_metrics d USING(owner_id,metric_date) WHERE d.score_status='imported')
   IS DISTINCT FROM (SELECT imported_ledger FROM indoor_bike_baseline)
 THEN RAISE EXCEPTION 'Imported ledger changed'; END IF;
 IF EXISTS (SELECT 1 FROM indoor_bike_baseline b, jsonb_array_elements(b.snapshots) prior
   WHERE NOT EXISTS (SELECT 1 FROM daily_score_snapshots s WHERE to_jsonb(s)=prior))
 THEN RAISE EXCEPTION 'Historical snapshot changed'; END IF;
 IF EXISTS (SELECT 1 FROM indoor_bike_baseline b, jsonb_array_elements(b.old_rules) prior
   WHERE NOT EXISTS (SELECT 1 FROM scoring_rules r WHERE to_jsonb(r)-'enabled'-'indoor_bike_coefficient'=prior-'enabled'))
 THEN RAISE EXCEPTION 'Historical rule definition changed'; END IF;
 IF EXISTS (SELECT 1 FROM daily_metrics d WHERE total_points <> (SELECT coalesce(sum(points),0) FROM score_ledger l WHERE l.owner_id=d.owner_id AND l.metric_date=d.metric_date))
 THEN RAISE EXCEPTION 'Ledger total disagreement'; END IF;
 IF EXISTS (SELECT 1 FROM daily_metrics d JOIN daily_score_snapshots s ON s.owner_id=d.owner_id AND s.id=d.score_snapshot_id
   WHERE s.total_points <> d.total_points OR s.facts_json->'stepsCalculation' <> '{"source":"stored","resolvedSteps":0}'::jsonb)
 THEN RAISE EXCEPTION 'Snapshot total or evidence mismatch'; END IF;
 IF (SELECT count(*) FROM scoring_rules WHERE enabled AND indoor_bike_coefficient=750) <> 4
 THEN RAISE EXCEPTION 'Missing versioned rules or customized family changed'; END IF;
 IF (SELECT count(*) FROM scoring_rules WHERE enabled AND owner_id='44444444-4444-4444-8444-444444444444' AND indoor_bike_coefficient=750) <> 2
 THEN RAISE EXCEPTION 'Disjoint rule ranges lost'; END IF;
END $$;
SELECT 'Indoor bike populated upgrade passed' AS result;

DO $$ BEGIN
 BEGIN
  UPDATE scoring_rules SET indoor_bike_coefficient = 0 WHERE indoor_bike_coefficient = 750;
  RAISE EXCEPTION 'Zero indoor coefficient accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE scoring_rules SET indoor_bike_coefficient = 'Infinity'::numeric WHERE indoor_bike_coefficient = 750;
  RAISE EXCEPTION 'Infinite indoor coefficient accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE scoring_rules SET indoor_bike_coefficient = 750 WHERE code = 'run.km.default';
  RAISE EXCEPTION 'Indoor override accepted for a run rule';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
