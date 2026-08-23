-- The 10k achievement is a pace-gated bonus, not a distance-only completion bonus.
-- The application scorer enforces the same condition for future recomputations.
update scoring_rules
set
  name = '10k run at five-minute pace',
  description = 'SportOS bonus. Award 2000 points when one canonical activity has distance at least 10000 meters and elapsed pace no slower than 300 seconds per kilometer (5:00/km). Effective from 1900-01-01.'
where code = 'run.10k.completed.bonus';

-- Remove already-persisted distance-only bonuses that fail the pace condition.
with invalid_bonus_points as (
  select sl.metric_date, sum(sl.points)::integer as invalid_points
  from score_ledger sl
  join scoring_rules sr on sr.id = sl.rule_id
  join activities a on a.id = sl.activity_id
  where sr.code = 'run.10k.completed.bonus'
    and (
      a.distance_m is null
      or a.duration_s is null
      or a.distance_m <= 0
      or a.duration_s > (a.distance_m / 1000.0) * 300
    )
  group by sl.metric_date
)
update daily_metrics dm
set
  bonus_points = dm.bonus_points - invalid.invalid_points,
  total_points = dm.total_points - invalid.invalid_points,
  recomputed_at = now()
from invalid_bonus_points invalid
where dm.metric_date = invalid.metric_date;

delete from score_ledger sl
using scoring_rules sr, activities a
where sr.id = sl.rule_id
  and a.id = sl.activity_id
  and sr.code = 'run.10k.completed.bonus'
  and (
    a.distance_m is null
    or a.duration_s is null
    or a.distance_m <= 0
    or a.duration_s > (a.distance_m / 1000.0) * 300
  );
