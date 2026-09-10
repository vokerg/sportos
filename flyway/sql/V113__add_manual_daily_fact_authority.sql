-- A user-authored daily fact set is a distinct score authority. The current
-- row remains fast to read while daily_score_snapshots preserves every version.

ALTER TABLE daily_metrics
  DROP CONSTRAINT daily_metrics_score_status_check,
  ADD CONSTRAINT daily_metrics_score_status_check
    CHECK (score_status IN ('imported', 'calculated', 'manual'));

ALTER TABLE daily_score_snapshots
  DROP CONSTRAINT daily_score_snapshots_score_status_check,
  ADD CONSTRAINT daily_score_snapshots_score_status_check
    CHECK (score_status IN ('imported', 'calculated', 'manual')),
  DROP CONSTRAINT daily_score_snapshots_trigger_check,
  ADD CONSTRAINT daily_score_snapshots_trigger_check
    CHECK (trigger IN (
      'workbook_import', 'manual_edit', 'manual_recalculation', 'rule_recomputation', 'legacy_migration'
    ));
