-- Imported workbook totals are authoritative until an explicit recalculation.
-- The current daily row stays fast to read; this append-only table preserves the
-- score version that was replaced whenever the application writes a score.

CREATE TABLE daily_score_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id(),
  metric_date date NOT NULL,
  score_status text NOT NULL CHECK (score_status IN ('imported', 'calculated')),
  base_points integer NOT NULL,
  bonus_points integer NOT NULL,
  total_points integer NOT NULL,
  facts_json jsonb NOT NULL CHECK (jsonb_typeof(facts_json) = 'object'),
  ledger_json jsonb NOT NULL CHECK (jsonb_typeof(ledger_json) = 'array'),
  source_record_id uuid,
  trigger text NOT NULL CHECK (trigger IN (
    'workbook_import', 'manual_recalculation', 'rule_recomputation', 'legacy_migration'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_daily_score_snapshots_totals
    CHECK (base_points + bonus_points = total_points),
  CONSTRAINT daily_score_snapshots_owner_fk
    FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  CONSTRAINT daily_score_snapshots_owner_source_fk
    FOREIGN KEY (owner_id, source_record_id)
    REFERENCES source_records(owner_id, id) ON DELETE SET NULL (source_record_id),
  CONSTRAINT uq_daily_score_snapshots_owner_id UNIQUE (owner_id, id)
);

CREATE INDEX idx_daily_score_snapshots_owner_date
  ON daily_score_snapshots (owner_id, metric_date, created_at DESC, id DESC);

ALTER TABLE daily_metrics
  ADD COLUMN score_status text NOT NULL DEFAULT 'calculated'
    CHECK (score_status IN ('imported', 'calculated')),
  ADD COLUMN score_snapshot_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM daily_metrics
    WHERE excel_all_points IS NOT NULL
      AND (
        excel_all_points < 0
        OR excel_all_points <> trunc(excel_all_points)
      )
  ) THEN
    RAISE EXCEPTION 'Cannot promote negative or fractional workbook All values to integer score ledgers';
  END IF;
END $$;

-- Keep the score that existed before this behavior change as the first
-- historical version. Rows with an imported All value are then promoted to an
-- imported authoritative version below.
WITH baseline AS (
  INSERT INTO daily_score_snapshots (
    owner_id,
    metric_date,
    score_status,
    base_points,
    bonus_points,
    total_points,
    facts_json,
    ledger_json,
    source_record_id,
    trigger
  )
  SELECT
    dm.owner_id,
    dm.metric_date,
    'calculated',
    dm.base_points,
    dm.bonus_points,
    dm.total_points,
    jsonb_build_object(
      'metricDate', dm.metric_date::text,
      'steps', dm.steps,
      'runM', dm.run_m,
      'bikeM', dm.bike_m,
      'swimM', dm.swim_m,
      'workoutPoints', dm.workout_points,
      'powerPoints', dm.power_points,
      'excelAllPoints', dm.excel_all_points,
      'excelRowHash', dm.excel_row_hash
    ),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', sl.id::text,
          'metricDate', sl.metric_date::text,
          'activityId', sl.activity_id,
          'ruleId', sl.rule_id,
          'points', sl.points,
          'reason', sl.reason,
          'calculationJson', sl.calculation_json,
          'createdAt', sl.created_at
        )
        ORDER BY sl.created_at, sl.id
      )
      FROM score_ledger sl
      WHERE sl.owner_id = dm.owner_id
        AND sl.metric_date = dm.metric_date
    ), '[]'::jsonb),
    dm.source_record_id,
    'legacy_migration'
  FROM daily_metrics dm
  RETURNING owner_id, metric_date, id
)
UPDATE daily_metrics dm
SET score_snapshot_id = baseline.id
FROM baseline
WHERE baseline.owner_id = dm.owner_id
  AND baseline.metric_date = dm.metric_date;

WITH imported AS (
  INSERT INTO daily_score_snapshots (
    owner_id,
    metric_date,
    score_status,
    base_points,
    bonus_points,
    total_points,
    facts_json,
    ledger_json,
    source_record_id,
    trigger
  )
  SELECT
    dm.owner_id,
    dm.metric_date,
    'imported',
    dm.excel_all_points::integer,
    0,
    dm.excel_all_points::integer,
    jsonb_build_object(
      'metricDate', dm.metric_date::text,
      'steps', dm.steps,
      'runM', dm.run_m,
      'bikeM', dm.bike_m,
      'swimM', dm.swim_m,
      'workoutPoints', dm.workout_points,
      'powerPoints', dm.power_points,
      'excelAllPoints', dm.excel_all_points,
      'excelRowHash', dm.excel_row_hash
    ),
    CASE
      WHEN dm.excel_all_points = 0 THEN '[]'::jsonb
      ELSE jsonb_build_array(jsonb_build_object(
        'metricDate', dm.metric_date::text,
        'activityId', NULL,
        'ruleId', NULL,
        'points', dm.excel_all_points::integer,
        'reason', 'Imported workbook ledger total',
        'calculationJson', jsonb_build_object(
          'scoreStatus', 'imported',
          'source', 'my_sport_xlsx',
          'field', 'All',
          'importedPoints', dm.excel_all_points
        )
      ))
    END,
    dm.source_record_id,
    'workbook_import'
  FROM daily_metrics dm
  WHERE dm.excel_all_points IS NOT NULL
  RETURNING owner_id, metric_date, id
)
UPDATE daily_metrics dm
SET
  score_status = 'imported',
  base_points = dm.excel_all_points::integer,
  bonus_points = 0,
  total_points = dm.excel_all_points::integer,
  score_snapshot_id = imported.id,
  recomputed_at = now()
FROM imported
WHERE imported.owner_id = dm.owner_id
  AND imported.metric_date = dm.metric_date;

DELETE FROM score_ledger sl
USING daily_metrics dm
WHERE dm.owner_id = sl.owner_id
  AND dm.metric_date = sl.metric_date
  AND dm.score_status = 'imported';

INSERT INTO score_ledger (
  owner_id,
  metric_date,
  activity_id,
  rule_id,
  points,
  reason,
  calculation_json
)
SELECT
  dm.owner_id,
  dm.metric_date,
  NULL,
  NULL,
  dm.excel_all_points::integer,
  'Imported workbook ledger total',
  jsonb_build_object(
    'scoreStatus', 'imported',
    'source', 'my_sport_xlsx',
    'field', 'All',
    'importedPoints', dm.excel_all_points
  )
FROM daily_metrics dm
WHERE dm.score_status = 'imported'
  AND dm.excel_all_points <> 0;

ALTER TABLE daily_metrics
  ADD CONSTRAINT daily_metrics_owner_snapshot_fk
  FOREIGN KEY (owner_id, score_snapshot_id)
  REFERENCES daily_score_snapshots(owner_id, id)
  ON DELETE RESTRICT;

ALTER TABLE daily_metrics
  ADD CONSTRAINT chk_daily_metrics_imported_score_authority
  CHECK (
    score_status <> 'imported'
    OR (
      excel_all_points IS NOT NULL
      AND excel_all_points >= 0
      AND excel_all_points = trunc(excel_all_points)
      AND base_points = excel_all_points
      AND bonus_points = 0
      AND total_points = excel_all_points
    )
  );

ALTER TABLE daily_score_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_score_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY daily_score_snapshots_account_isolation
  ON daily_score_snapshots
  TO sportos_app, sportos_legacy, sportos_worker_data
  USING (owner_id = sportos_current_account_id())
  WITH CHECK (owner_id = sportos_current_account_id());

CREATE OR REPLACE FUNCTION sportos_reject_daily_score_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Source-record cleanup may null only the provenance pointer. The score
  -- version itself remains immutable and its history row is retained.
  IF TG_OP = 'UPDATE'
     AND OLD.source_record_id IS NOT NULL
     AND NEW.source_record_id IS NULL
     AND NEW.id = OLD.id
     AND NEW.owner_id = OLD.owner_id
     AND NEW.metric_date = OLD.metric_date
     AND NEW.score_status = OLD.score_status
     AND NEW.base_points = OLD.base_points
     AND NEW.bonus_points = OLD.bonus_points
     AND NEW.total_points = OLD.total_points
     AND NEW.facts_json = OLD.facts_json
     AND NEW.ledger_json = OLD.ledger_json
     AND NEW.trigger = OLD.trigger
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'daily score snapshots are append-only';
END;
$$;

CREATE TRIGGER reject_daily_score_snapshot_mutation
  BEFORE UPDATE OR DELETE ON daily_score_snapshots
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_daily_score_snapshot_mutation();

CREATE TRIGGER reject_owner_change
  BEFORE UPDATE OF owner_id ON daily_score_snapshots
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();

REVOKE ALL ON daily_score_snapshots
  FROM sportos_data, sportos_legacy, sportos_worker, sportos_worker_data, sportos_app;

GRANT SELECT, INSERT ON daily_score_snapshots TO sportos_app, sportos_legacy, sportos_worker_data;

-- Keep the existing view column order stable and append the new source status.
CREATE OR REPLACE VIEW v_daily_summary WITH (security_invoker = true) AS
SELECT
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
  CASE WHEN dm.excel_all_points IS NULL THEN NULL ELSE dm.total_points - dm.excel_all_points END AS points_delta_vs_excel,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW) AS avg_10d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS avg_20d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS avg_30d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 59 PRECEDING AND CURRENT ROW) AS avg_60d,
  avg(dm.total_points) OVER (PARTITION BY dm.owner_id ORDER BY dm.metric_date ROWS BETWEEN 364 PRECEDING AND CURRENT ROW) AS avg_365d,
  dm.recomputed_at,
  dm.score_status
FROM daily_metrics dm;

DO $$
BEGIN
  IF NOT has_table_privilege('sportos_app', 'daily_score_snapshots', 'SELECT, INSERT') THEN
    RAISE EXCEPTION 'sportos_app must read and append daily score snapshots';
  END IF;
  IF has_table_privilege('sportos_app', 'daily_score_snapshots', 'UPDATE')
     OR has_table_privilege('sportos_app', 'daily_score_snapshots', 'DELETE') THEN
    RAISE EXCEPTION 'daily score snapshots must be append-only for sportos_app';
  END IF;
  IF has_table_privilege('sportos_worker', 'daily_score_snapshots', 'SELECT')
     OR has_table_privilege('sportos_worker', 'daily_score_snapshots', 'INSERT') THEN
    RAISE EXCEPTION 'sportos_worker dispatcher must not access daily score snapshots';
  END IF;
END $$;
