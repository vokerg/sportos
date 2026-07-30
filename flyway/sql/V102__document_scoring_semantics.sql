-- Make the enabled MVP-0 rule catalog deterministic and self-describing without
-- changing any coefficient, threshold, configured points, or effective period.
update scoring_rules
set
  priority = case code
    when 'steps.base' then 10
    when 'run.km.default' then 20
    when 'bike.km.default' then 30
    when 'swim.m.default' then 40
    when 'workout.manual' then 50
    when 'power.manual' then 60
    when 'run.5k.sub25.bonus' then 70
    when 'run.10k.completed.bonus' then 80
    when 'swim.1k.sub20.bonus' then 90
    when 'bike.10k.easy.bonus' then 100
    else priority
  end,
  description = case code
    when 'steps.base' then 'Base rule. Input unit: steps. Formula: steps * 1. Round once to the nearest integer per rule. Effective from 1900-01-01.'
    when 'run.km.default' then 'Base rule. Input unit: aggregate run kilometers. Formula: km * 1000. Round once to the nearest integer per rule. Effective from 1900-01-01; fixture formula evidence confirms this configured mapping.'
    when 'bike.km.default' then 'Base rule. Input unit: aggregate bike kilometers. Formula: km * 650. Round once to the nearest integer per rule. Effective from 1900-01-01. This remains a configured assumption until permitted historical workbook evidence proves a different coefficient.'
    when 'swim.m.default' then 'Base rule. Input unit: swim meters. Formula: meters * 7.5. Round once to the nearest integer per rule. Effective from 1900-01-01. This remains a configured assumption until permitted historical workbook evidence proves a different coefficient.'
    when 'workout.manual' then 'Base rule. Input unit: imported WOtotal points, rounded by the importer. Formula: points * 1, then nearest-integer rule rounding. Effective from 1900-01-01; HIIT and rowing source columns are not separately added.'
    when 'power.manual' then 'Bonus rule. Input unit: imported Pow points, rounded by the importer. Formula: points * 1, then nearest-integer rule rounding. Effective from 1900-01-01.'
    when 'run.5k.sub25.bonus' then 'SportOS bonus. Award 1000 points when duration is strictly below 1500 seconds and distance is within 500 meters of 5000 meters. Effective from 1900-01-01.'
    when 'run.10k.completed.bonus' then 'SportOS bonus. Award 2000 points when activity distance is at least 10000 meters. Effective from 1900-01-01.'
    when 'swim.1k.sub20.bonus' then 'SportOS bonus. Award 1000 points when duration is strictly below 1200 seconds and distance is at least 1000 meters. Effective from 1900-01-01.'
    when 'bike.10k.easy.bonus' then 'SportOS bonus. Award 1000 points when average speed is strictly below 20 km/h. The current engine does not add a separate minimum-distance condition. Effective from 1900-01-01.'
    else description
  end
where code in (
  'steps.base',
  'run.km.default',
  'bike.km.default',
  'swim.m.default',
  'workout.manual',
  'power.manual',
  'run.5k.sub25.bonus',
  'run.10k.completed.bonus',
  'swim.1k.sub20.bonus',
  'bike.10k.easy.bonus'
);

-- Prior application versions classified power.manual as base points because they
-- inferred bonuses from a '.bonus' code suffix. Correct existing daily aggregates
-- while preserving total_points.
with power_points_by_date as (
  select sl.metric_date, sum(sl.points)::integer as power_points
  from score_ledger sl
  join scoring_rules sr on sr.id = sl.rule_id
  where sr.activity_type = 'power_bonus'
  group by sl.metric_date
)
update daily_metrics dm
set
  base_points = dm.base_points - power.power_points,
  bonus_points = dm.bonus_points + power.power_points,
  recomputed_at = now()
from power_points_by_date power
where dm.metric_date = power.metric_date;

-- Preserve the classification correction in legacy ledger explanation payloads.
update score_ledger sl
set calculation_json = sl.calculation_json || jsonb_build_object(
  'classification', case
    when sr.rule_kind = 'achievement' or sr.activity_type = 'power_bonus' then 'bonus'
    else 'base'
  end,
  'ruleKind', sr.rule_kind,
  'activityType', sr.activity_type,
  'validFrom', sr.valid_from::text,
  'validTo', case when sr.valid_to is null then null else to_jsonb(sr.valid_to::text) end,
  'priority', sr.priority
)
from scoring_rules sr
where sr.id = sl.rule_id;
