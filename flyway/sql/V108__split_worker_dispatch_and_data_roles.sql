-- Queue dispatch needs cross-owner visibility, but canonical/source/rule execution
-- must remain account scoped. Split those capabilities into separate runtime roles.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_worker_data') THEN
    CREATE ROLE sportos_worker_data NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION IN ROLE sportos_data;
  END IF;
END $$;

-- The shared privilege role must not expose authentication control-plane tables.
REVOKE ALL PRIVILEGES ON TABLE accounts, external_identities, auth_sessions, auth_transactions FROM sportos_data;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE accounts, external_identities, auth_sessions, auth_transactions TO sportos_app;

-- Future tables require explicit grants in their migration. This prevents a new
-- credential/control-plane table from being inherited by every runtime role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM sportos_data;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'uploaded_files', 'import_batches', 'import_jobs', 'source_records',
    'activities', 'daily_metrics', 'scoring_rules', 'scoring_rule_changes',
    'score_ledger', 'performance_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS worker_system_access ON %I', table_name);
    EXECUTE format(
      'ALTER POLICY account_isolation ON %I TO sportos_app, sportos_legacy, sportos_worker_data',
      table_name
    );
  END LOOP;
END $$;

-- Dispatcher access is deliberately narrow. It can inspect stored-object metadata
-- required to claim an import and may transition queue/audit lifecycle rows, but it
-- cannot read or mutate source records, canonical facts, rules, or score ledgers.
CREATE POLICY worker_dispatch_upload_select ON uploaded_files
  FOR SELECT TO sportos_worker USING (true);

CREATE POLICY worker_dispatch_import_select ON import_jobs
  FOR SELECT TO sportos_worker USING (true);
CREATE POLICY worker_dispatch_import_update ON import_jobs
  FOR UPDATE TO sportos_worker USING (true) WITH CHECK (true);

CREATE POLICY worker_dispatch_rule_select ON scoring_rule_changes
  FOR SELECT TO sportos_worker USING (true);
CREATE POLICY worker_dispatch_rule_update ON scoring_rule_changes
  FOR UPDATE TO sportos_worker USING (true) WITH CHECK (true);
