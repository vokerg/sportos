-- Run after V133 in the same disposable fixture database as the setup script.
DO $$ BEGIN
IF (SELECT activities FROM running_effort_upgrade_baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM activities a)
  OR (SELECT daily FROM running_effort_upgrade_baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.owner_id,d.metric_date) FROM daily_metrics d)
  OR (SELECT ledger FROM running_effort_upgrade_baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM score_ledger l)
  OR (SELECT snapshots FROM running_effort_upgrade_baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM daily_score_snapshots s)
  OR (SELECT performance FROM running_effort_upgrade_baseline) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM performance_events p)
THEN RAISE EXCEPTION 'Running-effort migration changed official rows'; END IF;
IF (SELECT count(*) FROM running_effort_projections) <> 0
  OR (SELECT count(*) FROM running_effort_values) <> 0
  OR (SELECT count(*) FROM running_effort_heads) <> 0
THEN RAISE EXCEPTION 'Migration implicitly projected private data'; END IF;
END $$;
