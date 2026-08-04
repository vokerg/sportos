DROP VIEW IF EXISTS v_performance_events;

CREATE VIEW v_performance_events WITH (security_invoker = true) AS
SELECT
  pe.id,
  pe.activity_id,
  pe.source_record_id,
  pe.source,
  pe.event_date,
  pe.distance_m,
  pe.duration_s,
  pe.pace_s_per_km,
  pe.is_treadmill,
  pe.is_race,
  pe.is_pr_marker,
  pe.source_rank,
  pe.tags,
  pe.notes,
  pe.raw_payload_json,
  pe.created_at,
  rank() OVER (
    PARTITION BY pe.owner_id, pe.distance_m
    ORDER BY pe.duration_s ASC, pe.event_date ASC
  ) AS all_time_rank,
  min(pe.duration_s) OVER (
    PARTITION BY pe.owner_id, pe.distance_m
    ORDER BY pe.event_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) = pe.duration_s AS is_pr_by_time
FROM performance_events pe;

GRANT SELECT ON v_performance_events TO sportos_data;
