-- Daily Garmin summaries are exact date-level observations captured from the
-- Garmin Connect Steps view. They remain staged evidence and do not change
-- canonical facts or scores.

ALTER TABLE garmin_observations
  DROP CONSTRAINT garmin_observations_report_type_check;

ALTER TABLE garmin_observations
  ADD CONSTRAINT garmin_observations_report_type_check
  CHECK (report_type IN (
    'daily_summary',
    'steps_weekly',
    'calories_weekly',
    'floors_weekly',
    'weight_body_composition'
  ));
