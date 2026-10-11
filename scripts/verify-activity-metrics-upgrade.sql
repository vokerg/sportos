-- Run after V129 in the same disposable fixture database as the setup script.
DO $$ BEGIN
IF (SELECT activities FROM activity_metric_upgrade_baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM activities a)
  OR (SELECT daily FROM activity_metric_upgrade_baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.owner_id,d.metric_date) FROM daily_metrics d)
  OR (SELECT ledger FROM activity_metric_upgrade_baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM score_ledger l)
  OR (SELECT snapshots FROM activity_metric_upgrade_baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM daily_score_snapshots s)
  OR (SELECT performance FROM activity_metric_upgrade_baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM performance_events p)
THEN RAISE EXCEPTION 'Provider-metric migration changed official rows'; END IF;
IF (SELECT count(*) FROM activity_metric_projections) <> 0
  OR (SELECT count(*) FROM activity_provider_metric_values) <> 0
  OR (SELECT count(*) FROM activity_metric_heads) <> 0
THEN RAISE EXCEPTION 'Migration implicitly projected private data'; END IF;
END $$;
