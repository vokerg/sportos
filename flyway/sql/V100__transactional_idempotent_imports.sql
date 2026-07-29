-- Import identity and provenance policy for issue #5.
--
-- Raw source rows remain batch-scoped. Canonical rows use deterministic hashes that
-- are stable across batches, allowing a later import of the same workbook rows to
-- update/reuse canonical facts rather than append duplicates.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE daily_metrics
  ADD COLUMN IF NOT EXISTS source_record_id uuid;

ALTER TABLE performance_events
  ADD COLUMN IF NOT EXISTS source_record_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_metrics_source_record_id_fkey'
  ) THEN
    ALTER TABLE daily_metrics
      ADD CONSTRAINT daily_metrics_source_record_id_fkey
      FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Best-effort provenance backfill for daily rows imported before this migration.
UPDATE daily_metrics AS dm
SET source_record_id = (
  SELECT sr.id
  FROM source_records AS sr
  WHERE sr.source = 'my_sport_xlsx'
    AND sr.row_hash = dm.excel_row_hash
  ORDER BY sr.created_at, sr.id
  LIMIT 1
)
WHERE dm.source_record_id IS NULL
  AND dm.excel_row_hash IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM source_records AS sr
    WHERE sr.source = 'my_sport_xlsx'
      AND sr.row_hash = dm.excel_row_hash
  );

-- Activities imported before this migration contain their sheet and row location in
-- raw_payload_json. Match them to the temporally nearest source record at that
-- location, then rewrite the old payload hash into the new canonical identity hash.
UPDATE activities AS activity
SET source_record_id = (
  SELECT source_record.id
  FROM source_records AS source_record
  WHERE source_record.source = activity.source
    AND source_record.sheet_name = activity.raw_payload_json ->> 'sheetName'
    AND source_record.row_index = CASE
      WHEN (activity.raw_payload_json ->> 'rowIndex') ~ '^[0-9]+$'
        THEN (activity.raw_payload_json ->> 'rowIndex')::integer
      ELSE NULL
    END
  ORDER BY
    abs(extract(epoch FROM (source_record.created_at - activity.created_at))),
    source_record.created_at,
    source_record.id
  LIMIT 1
)
WHERE activity.source_record_id IS NULL
  AND activity.source = 'my_sport_xlsx'
  AND EXISTS (
    SELECT 1
    FROM source_records AS source_record
    WHERE source_record.source = activity.source
      AND source_record.sheet_name = activity.raw_payload_json ->> 'sheetName'
      AND source_record.row_index = CASE
        WHEN (activity.raw_payload_json ->> 'rowIndex') ~ '^[0-9]+$'
          THEN (activity.raw_payload_json ->> 'rowIndex')::integer
        ELSE NULL
      END
  );

UPDATE activities AS activity
SET source_record_hash = encode(
  digest(
    '{"sourceRowHash":"' || source_record.row_hash
      || '","entity":"activity","activityType":"' || activity.activity_type
      || '","subtype":"' || coalesce(activity.subtype, 'unknown') || '"}',
    'sha256'
  ),
  'hex'
)
FROM source_records AS source_record
WHERE activity.source = 'my_sport_xlsx'
  AND activity.source_record_id = source_record.id;

-- Best-effort provenance backfill for performance rows imported before this
-- migration. The raw performance payload carries the original sheet, row, and
-- cells, which can be matched to source_records without interpreting semantics.
UPDATE performance_events AS pe
SET source_record_id = (
  SELECT sr.id
  FROM source_records AS sr
  WHERE sr.source = pe.source
    AND sr.sheet_name = pe.raw_payload_json ->> 'sheetName'
    AND sr.row_index = CASE
      WHEN (pe.raw_payload_json ->> 'rowIndex') ~ '^[0-9]+$'
        THEN (pe.raw_payload_json ->> 'rowIndex')::integer
      ELSE NULL
    END
    AND sr.raw_json -> 'cells' = pe.raw_payload_json -> 'cells'
  ORDER BY
    abs(extract(epoch FROM (sr.created_at - pe.created_at))),
    sr.created_at,
    sr.id
  LIMIT 1
)
WHERE pe.source_record_id IS NULL
  AND pe.source = 'run_db_xlsx'
  AND EXISTS (
    SELECT 1
    FROM source_records AS sr
    WHERE sr.source = pe.source
      AND sr.sheet_name = pe.raw_payload_json ->> 'sheetName'
      AND sr.row_index = CASE
        WHEN (pe.raw_payload_json ->> 'rowIndex') ~ '^[0-9]+$'
          THEN (pe.raw_payload_json ->> 'rowIndex')::integer
        ELSE NULL
      END
      AND sr.raw_json -> 'cells' = pe.raw_payload_json -> 'cells'
  );

UPDATE performance_events AS pe
SET source_record_hash = sr.row_hash
FROM source_records AS sr
WHERE pe.source_record_id = sr.id
  AND pe.source_record_hash IS NULL;

-- Collapse duplicate activities created by historical repeated imports before
-- installing the canonical identity index. References are repointed to the
-- earliest canonical row.
CREATE TEMP TABLE activity_import_duplicates ON COMMIT DROP AS
SELECT
  id,
  first_value(id) OVER (
    PARTITION BY source, source_record_hash
    ORDER BY created_at, id
  ) AS keep_id,
  row_number() OVER (
    PARTITION BY source, source_record_hash
    ORDER BY created_at, id
  ) AS duplicate_rank
FROM activities
WHERE source_record_hash IS NOT NULL;

UPDATE score_ledger AS ledger
SET activity_id = duplicates.keep_id
FROM activity_import_duplicates AS duplicates
WHERE duplicates.duplicate_rank > 1
  AND ledger.activity_id = duplicates.id;

UPDATE performance_events AS event
SET activity_id = duplicates.keep_id
FROM activity_import_duplicates AS duplicates
WHERE duplicates.duplicate_rank > 1
  AND event.activity_id = duplicates.id;

UPDATE source_records AS source_record
SET normalized_entity_id = duplicates.keep_id::text
FROM activity_import_duplicates AS duplicates
WHERE duplicates.duplicate_rank > 1
  AND source_record.normalized_entity_type = 'activity'
  AND source_record.normalized_entity_id = duplicates.id::text;

DELETE FROM activities AS activity
USING activity_import_duplicates AS duplicates
WHERE duplicates.duplicate_rank > 1
  AND activity.id = duplicates.id;

-- Collapse performance duplicates that can now be identified through their raw
-- source row hash.
CREATE TEMP TABLE performance_import_duplicates ON COMMIT DROP AS
SELECT
  id,
  first_value(id) OVER (
    PARTITION BY source, source_record_hash
    ORDER BY created_at, id
  ) AS keep_id,
  row_number() OVER (
    PARTITION BY source, source_record_hash
    ORDER BY created_at, id
  ) AS duplicate_rank
FROM performance_events
WHERE source_record_hash IS NOT NULL;

UPDATE source_records AS source_record
SET normalized_entity_id = duplicates.keep_id::text
FROM performance_import_duplicates AS duplicates
WHERE duplicates.duplicate_rank > 1
  AND source_record.normalized_entity_type = 'performance_event'
  AND source_record.normalized_entity_id = duplicates.id::text;

DELETE FROM performance_events AS event
USING performance_import_duplicates AS duplicates
WHERE duplicates.duplicate_rank > 1
  AND event.id = duplicates.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_records_batch_key_hash
  ON source_records (import_batch_id, source_record_key, row_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_activities_source_identity
  ON activities (source, source_record_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_performance_events_source_identity
  ON performance_events (source, source_record_hash);

CREATE INDEX IF NOT EXISTS ix_activities_source_record_id
  ON activities (source_record_id);

CREATE INDEX IF NOT EXISTS ix_daily_metrics_source_record_id
  ON daily_metrics (source_record_id);

CREATE INDEX IF NOT EXISTS ix_performance_events_source_record_id
  ON performance_events (source_record_id);
