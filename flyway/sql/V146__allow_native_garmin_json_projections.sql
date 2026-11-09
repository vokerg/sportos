-- Native Connect provenance; no canonical/scoring DML or historical rewrites.
ALTER TABLE activity_provider_metric_values DROP CONSTRAINT activity_provider_metric_values_source_kind_check;
ALTER TABLE activity_provider_metric_values ADD CONSTRAINT activity_provider_metric_values_source_kind_check
 CHECK (source_kind IN ('compact','strava_detail','fit_session','strength_summary','canonical_fallback','garmin_summary'));
-- Locate only the two unnamed V133 checks containing the method/provider and
-- method/pause-policy contracts. Preserve all status, bounds and owner checks.
DO $$
DECLARE c record;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='running_effort_values'::regclass AND contype='c'
  AND (pg_get_constraintdef(oid) LIKE '%provider%method%' OR pg_get_constraintdef(oid) LIKE '%method%pause_policy%') LOOP
  EXECUTE format('ALTER TABLE running_effort_values DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE running_effort_values DROP CONSTRAINT running_effort_values_pause_policy_check;
ALTER TABLE running_effort_values ADD CONSTRAINT running_effort_values_pause_policy_check CHECK (pause_policy IN ('summary_moving','moving_flags','timer_events','cumulative_timer'));
ALTER TABLE running_effort_values ADD CONSTRAINT running_effort_native_method_check
 CHECK ((provider='strava' AND method IN ('summary_estimate','stream_calculated')) OR (provider='garmin' AND method IN ('fit_calculated','json_calculated')));
ALTER TABLE running_effort_values ADD CONSTRAINT running_effort_native_pause_check
 CHECK ((method='summary_estimate' AND pause_policy='summary_moving') OR (method='stream_calculated' AND pause_policy='moving_flags') OR (method='fit_calculated' AND pause_policy='timer_events') OR (method='json_calculated' AND pause_policy='cumulative_timer'));
