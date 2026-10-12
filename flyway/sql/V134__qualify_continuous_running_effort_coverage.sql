-- Permit only the explicit continuous-section qualification for calculated
-- Strava windows. Preserve existing history, RLS, grants and all metric bounds.
ALTER TABLE running_effort_values DROP CONSTRAINT running_effort_values_check1;
ALTER TABLE running_effort_values ADD CONSTRAINT running_effort_values_quality_check
  CHECK ((status='unavailable' AND duration_s IS NULL AND start_offset_s IS NULL AND end_offset_s IS NULL AND reason IS NOT NULL)
    OR (status='estimated' AND method='summary_estimate' AND duration_s IS NOT NULL AND start_offset_s IS NULL AND end_offset_s IS NULL AND pause_coverage='summary')
    OR (status='calculated' AND method<>'summary_estimate' AND duration_s IS NOT NULL AND start_offset_s IS NOT NULL AND end_offset_s IS NOT NULL AND end_offset_s>start_offset_s AND duration_s<=end_offset_s-start_offset_s+0.000001 AND pause_coverage='validated'
      AND (reason IS NULL OR (method='stream_calculated' AND reason='partial_stream_coverage'))));
