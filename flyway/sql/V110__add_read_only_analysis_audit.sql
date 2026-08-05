-- Read-only analysis audit boundary for issue #16.
-- The model/tool layer cannot mutate canonical data. This table stores only
-- bounded request metadata, source identifiers, generator metadata, and outcome.

CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id()
    REFERENCES accounts(id) ON DELETE RESTRICT,
  question_hash char(64) NOT NULL CHECK (question_hash ~ '^[0-9a-f]{64}$'),
  tool_name text CHECK (tool_name IS NULL OR tool_name IN ('daily_summary', 'daily_score_breakdown')),
  input_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(input_summary_json) = 'object'),
  citation_keys text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (cardinality(citation_keys) <= 2000),
  generator text NOT NULL CHECK (generator IN ('none', 'deterministic_fallback', 'external_model')),
  model_provider text CHECK (model_provider IS NULL OR char_length(model_provider) <= 100),
  model_name text CHECK (model_name IS NULL OR char_length(model_name) <= 200),
  outcome text NOT NULL CHECK (outcome IN (
    'tool_succeeded', 'answered', 'insufficient_data', 'refused', 'fallback', 'failed'
  )),
  data_quality_status text CHECK (
    data_quality_status IS NULL OR data_quality_status IN ('complete', 'partial', 'missing', 'conflicting')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_analysis_runs_owner_id UNIQUE (owner_id, id)
);

CREATE INDEX idx_analysis_runs_owner_created
  ON analysis_runs (owner_id, created_at DESC, id DESC);

ALTER TABLE analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY analysis_runs_account_isolation ON analysis_runs
  TO sportos_app
  USING (owner_id = sportos_current_account_id())
  WITH CHECK (owner_id = sportos_current_account_id());

CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON analysis_runs
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change();

REVOKE ALL ON analysis_runs
  FROM sportos_data, sportos_legacy, sportos_worker, sportos_worker_data, sportos_app;
GRANT SELECT, INSERT ON analysis_runs TO sportos_app;

DO $$
BEGIN
  IF NOT has_table_privilege('sportos_app', 'analysis_runs', 'SELECT, INSERT') THEN
    RAISE EXCEPTION 'sportos_app must insert and inspect owner-scoped analysis audit rows';
  END IF;
  IF has_table_privilege('sportos_app', 'analysis_runs', 'UPDATE')
     OR has_table_privilege('sportos_app', 'analysis_runs', 'DELETE') THEN
    RAISE EXCEPTION 'analysis audit rows must be append-only for sportos_app';
  END IF;
  IF has_table_privilege('sportos_worker', 'analysis_runs', 'SELECT')
     OR has_table_privilege('sportos_worker_data', 'analysis_runs', 'SELECT')
     OR has_table_privilege('sportos_legacy', 'analysis_runs', 'SELECT') THEN
    RAISE EXCEPTION 'analysis audit rows must not be exposed to worker or legacy roles';
  END IF;
END $$;
