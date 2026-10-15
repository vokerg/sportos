-- Run after V136 on the disposable fixture database, as its schema owner.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM swim_moving_upgrade_cases c JOIN daily_metrics dm USING(owner_id,metric_date)
    WHERE dm.bonus_points <> 777+c.expected_bonus OR dm.total_points <> 8277+c.expected_bonus OR dm.base_points <> 7500 OR dm.score_status <> c.score_status)
    THEN RAISE EXCEPTION 'Swim tier totals/status mismatch'; END IF;
  IF (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM activities a) IS DISTINCT FROM (SELECT activities FROM swim_moving_upgrade_baseline)
    THEN RAISE EXCEPTION 'Canonical activities changed'; END IF;
  IF (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.owner_id,d.metric_date) FROM daily_metrics d WHERE d.score_status='imported') IS DISTINCT FROM (SELECT imported FROM swim_moving_upgrade_baseline)
    THEN RAISE EXCEPTION 'Imported authority changed'; END IF;
  IF EXISTS (SELECT 1 FROM swim_moving_upgrade_baseline b, jsonb_array_elements(b.snapshots) s
    WHERE NOT EXISTS (SELECT 1 FROM daily_score_snapshots current WHERE to_jsonb(current)=s))
    THEN RAISE EXCEPTION 'Historical snapshots changed'; END IF;
  IF EXISTS (SELECT 1 FROM swim_moving_upgrade_baseline b, jsonb_array_elements(b.preserved_ledger) l
    WHERE NOT EXISTS (SELECT 1 FROM score_ledger current WHERE to_jsonb(current)=l))
    THEN RAISE EXCEPTION 'Unrelated/imported ledgers changed'; END IF;
  IF EXISTS (SELECT 1 FROM swim_moving_upgrade_baseline b, jsonb_array_elements(b.prior_rules) r
    WHERE NOT EXISTS (SELECT 1 FROM scoring_rules current WHERE to_jsonb(current)-'enabled'=r-'enabled' AND NOT current.enabled))
    THEN RAISE EXCEPTION 'Historical rule definitions changed'; END IF;
  IF (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM scoring_rules r WHERE r.owner_id='44444444-4444-4444-8444-444444444444') IS DISTINCT FROM (SELECT custom_rules FROM swim_moving_upgrade_baseline)
    THEN RAISE EXCEPTION 'Customized account rules changed'; END IF;
  IF (SELECT count(*) FROM scoring_rules WHERE owner_id='33333333-3333-4333-8333-333333333333' AND achievement_group='swim.pace.1k' AND enabled) <> 8
    THEN RAISE EXCEPTION 'Disjoint effective ranges not preserved'; END IF;
  IF EXISTS (SELECT 1 FROM swim_moving_upgrade_cases c JOIN score_ledger l USING(owner_id,metric_date)
    JOIN scoring_rules r ON r.owner_id=l.owner_id AND r.id=l.rule_id
    WHERE c.score_status<>'imported' AND r.achievement_group='swim.pace.1k' AND l.calculation_json->>'classification'='bonus' AND
      (r.metric <> 'moving_pace_s_per_km' OR l.calculation_json->>'multiplierValue'<>'1' OR l.points<>c.expected_bonus))
    THEN RAISE EXCEPTION 'Contribution rule/multiplier mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM swim_moving_upgrade_cases c JOIN daily_metrics dm USING(owner_id,metric_date)
    JOIN daily_score_snapshots s ON s.owner_id=dm.owner_id AND s.id=dm.score_snapshot_id
    WHERE s.facts_json->'stepsCalculation' <> '{"source":"stored","resolvedSteps":0}'::jsonb)
    THEN RAISE EXCEPTION 'Snapshot evidence metadata lost'; END IF;
  IF EXISTS (SELECT 1 FROM swim_moving_upgrade_cases c JOIN score_ledger l USING(owner_id,metric_date)
    JOIN scoring_rules r ON r.id=l.rule_id WHERE c.score_status<>'imported'
      AND r.achievement_group='swim.pace.1k' AND l.calculation_json->'auxiliaryConditions'->1->>'metric'<>'moving_time_s')
    THEN RAISE EXCEPTION 'Moving input provenance missing'; END IF;
  IF EXISTS (SELECT 1 FROM daily_metrics dm WHERE dm.total_points <> (SELECT coalesce(sum(l.points),0) FROM score_ledger l WHERE l.owner_id=dm.owner_id AND l.metric_date=dm.metric_date))
    THEN RAISE EXCEPTION 'Ledger totals disagree'; END IF;
END $$;
SELECT 'Swim upgrade: tier boundaries, owner scopes, imported/base/history preservation and ledger parity passed' AS result;
