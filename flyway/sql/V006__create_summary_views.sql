create or replace view v_daily_summary as
select
  dm.metric_date,
  dm.steps,
  dm.run_m,
  dm.bike_m,
  dm.swim_m,
  dm.workout_points,
  dm.power_points,
  dm.base_points,
  dm.bonus_points,
  dm.total_points,
  dm.excel_all_points,
  case when dm.excel_all_points is null then null else dm.total_points - dm.excel_all_points end as points_delta_vs_excel,
  avg(dm.total_points) over (order by dm.metric_date rows between 9 preceding and current row) as avg_10d,
  avg(dm.total_points) over (order by dm.metric_date rows between 19 preceding and current row) as avg_20d,
  avg(dm.total_points) over (order by dm.metric_date rows between 29 preceding and current row) as avg_30d,
  avg(dm.total_points) over (order by dm.metric_date rows between 59 preceding and current row) as avg_60d,
  avg(dm.total_points) over (order by dm.metric_date rows between 364 preceding and current row) as avg_365d
from daily_metrics dm;

create or replace view v_score_breakdown as
select
  sl.metric_date,
  a.activity_type,
  a.subtype,
  sr.code as rule_code,
  sr.name as rule_name,
  sl.points,
  sl.reason,
  sl.calculation_json
from score_ledger sl
left join activities a on a.id = sl.activity_id
left join scoring_rules sr on sr.id = sl.rule_id;

create or replace view v_performance_events as
select
  pe.*,
  rank() over (partition by pe.distance_m order by pe.duration_s asc, pe.event_date asc) as all_time_rank,
  min(pe.duration_s) over (partition by pe.distance_m order by pe.event_date rows between unbounded preceding and current row) = pe.duration_s as is_pr_by_time
from performance_events pe;
