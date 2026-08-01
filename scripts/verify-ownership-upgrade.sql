\set ON_ERROR_STOP on

DO $$
DECLARE
  legacy uuid := '00000000-0000-4000-8000-000000000001';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = legacy) THEN
    RAISE EXCEPTION 'legacy account was not created';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM uploaded_files WHERE id = '10000000-0000-4000-8000-000000000001' AND owner_id = legacy) THEN
    RAISE EXCEPTION 'upload ownership/identity was not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM import_batches WHERE id = '10000000-0000-4000-8000-000000000002' AND owner_id = legacy AND uploaded_file_id = '10000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'batch ownership/provenance was not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM import_jobs WHERE id = '10000000-0000-4000-8000-000000000003' AND owner_id = legacy AND import_batch_id = '10000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'job ownership/batch link was not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM source_records WHERE id = '10000000-0000-4000-8000-000000000004' AND owner_id = legacy AND import_batch_id = '10000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'source-record ownership/batch link was not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM activities WHERE id = '10000000-0000-4000-8000-000000000005' AND owner_id = legacy AND source_record_id = '10000000-0000-4000-8000-000000000004') THEN
    RAISE EXCEPTION 'activity ownership/source link was not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM daily_metrics WHERE metric_date = '2096-08-01' AND owner_id = legacy AND source_record_id = '10000000-0000-4000-8000-000000000004') THEN
    RAISE EXCEPTION 'daily ownership/source link was not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM scoring_rules WHERE id = '10000000-0000-4000-8000-000000000006' AND owner_id = legacy) THEN
    RAISE EXCEPTION 'rule ownership/identity was not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM scoring_rule_changes WHERE id = '10000000-0000-4000-8000-000000000007' AND owner_id = legacy AND proposed_rule_id = '10000000-0000-4000-8000-000000000006') THEN
    RAISE EXCEPTION 'rule-change ownership/link was not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM score_ledger WHERE id = '10000000-0000-4000-8000-000000000008' AND owner_id = legacy AND activity_id = '10000000-0000-4000-8000-000000000005' AND rule_id = '10000000-0000-4000-8000-000000000006') THEN
    RAISE EXCEPTION 'ledger ownership/activity/rule links were not preserved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM performance_events WHERE id = '10000000-0000-4000-8000-000000000009' AND owner_id = legacy AND activity_id = '10000000-0000-4000-8000-000000000005' AND source_record_id = '10000000-0000-4000-8000-000000000004') THEN
    RAISE EXCEPTION 'performance ownership/provenance links were not preserved';
  END IF;

  IF EXISTS (
    SELECT owner_id FROM (
      SELECT owner_id FROM uploaded_files WHERE id = '10000000-0000-4000-8000-000000000001'
      UNION ALL SELECT owner_id FROM import_batches WHERE id = '10000000-0000-4000-8000-000000000002'
      UNION ALL SELECT owner_id FROM import_jobs WHERE id = '10000000-0000-4000-8000-000000000003'
      UNION ALL SELECT owner_id FROM source_records WHERE id = '10000000-0000-4000-8000-000000000004'
      UNION ALL SELECT owner_id FROM activities WHERE id = '10000000-0000-4000-8000-000000000005'
      UNION ALL SELECT owner_id FROM daily_metrics WHERE metric_date = '2096-08-01'
      UNION ALL SELECT owner_id FROM scoring_rules WHERE id = '10000000-0000-4000-8000-000000000006'
      UNION ALL SELECT owner_id FROM scoring_rule_changes WHERE id = '10000000-0000-4000-8000-000000000007'
      UNION ALL SELECT owner_id FROM score_ledger WHERE id = '10000000-0000-4000-8000-000000000008'
      UNION ALL SELECT owner_id FROM performance_events WHERE id = '10000000-0000-4000-8000-000000000009'
    ) owned
    WHERE owner_id IS DISTINCT FROM legacy
  ) THEN
    RAISE EXCEPTION 'one or more backfilled rows have the wrong owner';
  END IF;
END $$;
