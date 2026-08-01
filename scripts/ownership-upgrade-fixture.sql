\set ON_ERROR_STOP on

INSERT INTO uploaded_files (
  id, workbook_kind, storage_provider, object_key, original_filename,
  sanitized_filename, content_type, byte_size, sha256, status,
  last_error, imported_at, deleted_at
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'my_sport', 'local',
  'upgrade/fixture', 'upgrade.xlsx', 'upgrade.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  128, repeat('a', 64), 'imported', NULL, now(), NULL
);

INSERT INTO import_batches (
  id, uploaded_file_id, source, source_kind, filename, original_sha256,
  status, row_count, normalized_count, error_count, warning_count,
  completed_at, metadata
) VALUES (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  'upgrade_fixture', 'xlsx', 'upgrade.xlsx', repeat('a', 64),
  'scored', 1, 1, 0, 0, now(), '{}'::jsonb
);

INSERT INTO import_jobs (
  id, uploaded_file_id, import_batch_id, status, phase, progress_percent,
  attempt_count, max_attempts, lease_owner, lease_expires_at, heartbeat_at,
  cancellation_requested_at, next_attempt_at, error_code, error_message,
  result_json, started_at, completed_at
) VALUES (
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'succeeded', 'completed', 100, 1, 3, NULL, NULL, now(), NULL,
  now(), NULL, NULL, '{"fixture":true}'::jsonb, now(), now()
);

INSERT INTO source_records (
  id, import_batch_id, source, sheet_name, row_index, source_record_key,
  row_hash, raw_json, normalized_entity_type, normalized_entity_id,
  status, errors, warnings
) VALUES (
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000002',
  'upgrade_fixture', 'Daily', 2, 'Daily:2', repeat('b', 64),
  '{"private":"retained"}'::jsonb, 'daily_metric', NULL,
  'normalized', '[]'::jsonb, '[]'::jsonb
);

INSERT INTO activities (
  id, source, source_record_id, source_activity_id, source_record_hash,
  activity_date, start_time, activity_type, subtype, distance_m, duration_s,
  moving_time_s, steps, calories, avg_hr, max_hr, elevation_gain_m,
  avg_speed_mps, avg_pace_s_per_km, effort_points, notes, raw_payload_json
) VALUES (
  '10000000-0000-4000-8000-000000000005',
  'my_sport_xlsx', '10000000-0000-4000-8000-000000000004', NULL,
  repeat('c', 64), '2096-08-01', NULL, 'run', 'outdoor', 5000, 1500,
  1490, NULL, NULL, NULL, NULL, NULL, NULL, 300, NULL,
  'upgrade activity', '{"private":"activity"}'::jsonb
);

INSERT INTO daily_metrics (
  metric_date, source_record_id, steps, run_m, bike_m, swim_m,
  workout_points, power_points, base_points, bonus_points, total_points,
  excel_all_points, excel_row_hash
) VALUES (
  '2096-08-01', '10000000-0000-4000-8000-000000000004',
  1000, 5000, 0, 0, 0, 0, 5000, 0, 5000, 5000, repeat('b', 64)
);

INSERT INTO scoring_rules (
  id, code, version, supersedes_rule_id, name, activity_type, rule_kind,
  metric, coefficient, threshold_operator, threshold_value, threshold_unit,
  points, valid_from, valid_to, priority, enabled, description
) VALUES (
  '10000000-0000-4000-8000-000000000006',
  'upgrade.test', 1, NULL, 'Upgrade test rule', 'run', 'coefficient',
  'distance_m', 1, NULL, NULL, NULL, NULL, '2096-01-01', NULL,
  100, false, 'Ownership upgrade fixture'
);

INSERT INTO scoring_rule_changes (
  id, rule_code, previous_rule_id, proposed_rule_id, status, phase,
  progress_percent, attempt_count, max_attempts, lease_owner,
  lease_expires_at, heartbeat_at, cancellation_requested_at, next_attempt_at,
  initiated_by, reason, proposal_json, preview_json, preview_fingerprint,
  affected_from, affected_to, error_code, error_message, result_json,
  started_at, completed_at
) VALUES (
  '10000000-0000-4000-8000-000000000007',
  'upgrade.test', NULL, '10000000-0000-4000-8000-000000000006',
  'succeeded', 'completed', 100, 1, 3, NULL, NULL, now(), NULL, now(),
  'local-user', 'Ownership upgrade fixture', '{}'::jsonb, '{}'::jsonb,
  repeat('d', 64), '2096-08-01', '2096-08-01', NULL, NULL,
  '{"fixture":true}'::jsonb, now(), now()
);

INSERT INTO score_ledger (
  id, metric_date, activity_id, rule_id, points, reason, calculation_json
) VALUES (
  '10000000-0000-4000-8000-000000000008', '2096-08-01',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
  5000, 'Upgrade fixture ledger', '{"fixture":true}'::jsonb
);

INSERT INTO performance_events (
  id, activity_id, source_record_id, source_record_hash, source,
  event_date, distance_m, duration_s, pace_s_per_km, is_treadmill,
  is_race, is_pr_marker, source_rank, tags, notes, raw_payload_json
) VALUES (
  '10000000-0000-4000-8000-000000000009',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000004', repeat('e', 64),
  'run_db_xlsx', '2096-08-01', 5000, 1500, 300, false,
  true, true, 1, ARRAY['fixture'], 'Upgrade fixture performance',
  '{"private":"performance"}'::jsonb
);
