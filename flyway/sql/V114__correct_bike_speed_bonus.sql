-- The bike achievement is a fast 10 km ride: use provider average speed,
-- require at least 10 km, and award the bonus only above 20 km/h.
-- Preserve the previous definition as an immutable, disabled rule version.

WITH disabled AS (
  UPDATE scoring_rules
  SET enabled = false
  WHERE code = 'bike.10k.easy.bonus'
    AND version = 1
    AND enabled = true
    AND activity_type = 'bike'
    AND rule_kind = 'achievement'
    AND metric = 'avg_speed_kmh'
    AND threshold_operator = 'lt'
    AND threshold_value = 20
    AND threshold_unit = 'kmh'
    AND points = 1000
  RETURNING owner_id, id, code, version, name, activity_type, rule_kind,
    metric, coefficient, threshold_value, threshold_unit, points, valid_from,
    valid_to, priority, description
)
INSERT INTO scoring_rules (
  owner_id,
  code,
  version,
  supersedes_rule_id,
  name,
  activity_type,
  rule_kind,
  metric,
  coefficient,
  threshold_operator,
  threshold_value,
  threshold_unit,
  points,
  valid_from,
  valid_to,
  priority,
  enabled,
  description
)
SELECT
  owner_id,
  code,
  version + 1,
  id,
  '10k ride above 20 km/h',
  activity_type,
  rule_kind,
  metric,
  coefficient,
  'gt',
  threshold_value,
  threshold_unit,
  points,
  valid_from,
  valid_to,
  priority,
  true,
  'SportOS bonus. Award 1000 points when one canonical bike activity has distance at least 10000 meters and average speed strictly above 20 km/h. Effective from 1900-01-01.'
FROM disabled;
