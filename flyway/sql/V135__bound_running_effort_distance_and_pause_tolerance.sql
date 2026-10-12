-- Analytical tolerance only. Preserve source/coverage metrics, immutable history,
-- RLS, ownership, privileges and all canonical/scoring/performance rows.
ALTER TABLE running_effort_values DROP CONSTRAINT running_effort_values_quality_check;
ALTER TABLE running_effort_values ADD CONSTRAINT running_effort_values_quality_check
  CHECK ((status='unavailable' AND duration_s IS NULL AND start_offset_s IS NULL AND end_offset_s IS NULL AND reason IS NOT NULL)
    OR (status='estimated' AND method='summary_estimate' AND duration_s IS NOT NULL AND start_offset_s IS NULL AND end_offset_s IS NULL AND pause_coverage='summary')
    OR (status='calculated' AND method<>'summary_estimate' AND duration_s IS NOT NULL AND start_offset_s IS NOT NULL AND end_offset_s IS NOT NULL AND end_offset_s>start_offset_s AND duration_s<=end_offset_s-start_offset_s+0.000001 AND pause_coverage='validated'
      AND (reason IS NULL OR reason='distance_tolerance' OR (method='stream_calculated' AND reason IN ('partial_stream_coverage','partial_stream_coverage_with_tolerance','bounded_pause_boundary','distance_and_pause_tolerance')))));
ALTER TABLE running_effort_values DROP CONSTRAINT running_effort_values_check2;
ALTER TABLE running_effort_values ADD CONSTRAINT running_effort_values_coverage_check
  CHECK (duration_s IS NULL OR (source_distance_m IS NOT NULL AND coverage_distance_m IS NOT NULL AND coverage_distance_m<=source_distance_m
    AND (target_distance_m<=coverage_distance_m OR (status='calculated' AND reason IS NOT NULL AND reason IN ('distance_tolerance','distance_and_pause_tolerance','partial_stream_coverage_with_tolerance')
      AND target_distance_m-coverage_distance_m<=least(10.0,target_distance_m*0.001)+0.000000001))));
