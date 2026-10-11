-- Compact independent analytical results only; no source/scoring DML.
CREATE TABLE running_effort_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  activity_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('strava','garmin')),
  source_ref uuid NOT NULL,
  source_version char(64) NOT NULL CHECK (source_version ~ '^[a-f0-9]{64}$'),
  resource_hash char(32) CHECK (resource_hash ~ '^[a-f0-9]{32}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  algorithm_version integer NOT NULL CHECK (algorithm_version BETWEEN 1 AND 10000),
  projected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,activity_id,provider,source_ref,source_version,input_hash,algorithm_version),
  UNIQUE(owner_id,activity_id,provider,id)
);
CREATE TRIGGER check_effort_activity_owner BEFORE INSERT ON running_effort_projections
  FOR EACH ROW EXECUTE FUNCTION sportos_check_garmin_audit_activity_owner();
CREATE TRIGGER check_effort_source BEFORE INSERT ON running_effort_projections
  FOR EACH ROW EXECUTE FUNCTION sportos_check_activity_metric_source();
CREATE TABLE running_effort_values (
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  activity_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('strava','garmin')),
  projection_id uuid NOT NULL,
  target_distance_m double precision NOT NULL CHECK (target_distance_m BETWEEN 1 AND 1000000),
  method text NOT NULL CHECK ((provider='strava' AND method IN ('summary_estimate','stream_calculated')) OR (provider='garmin' AND method='fit_calculated')),
  status text NOT NULL CHECK (status IN ('estimated','calculated','unavailable')),
  reason text CHECK (reason ~ '^[a-z][a-z_]{0,79}$'),
  duration_s double precision CHECK (duration_s > 0 AND duration_s <= 604800),
  source_distance_m double precision CHECK (source_distance_m BETWEEN 0 AND 1000000),
  coverage_distance_m double precision CHECK (coverage_distance_m BETWEEN 0 AND 1000000),
  start_offset_s double precision CHECK (start_offset_s BETWEEN 0 AND 604800),
  end_offset_s double precision CHECK (end_offset_s BETWEEN 0 AND 604800),
  pause_policy text NOT NULL CHECK (pause_policy IN ('summary_moving','moving_flags','timer_events')),
  pause_coverage text NOT NULL CHECK (pause_coverage IN ('summary','validated','unknown')),
  PRIMARY KEY(owner_id,projection_id,target_distance_m),
  FOREIGN KEY(owner_id,activity_id,provider,projection_id) REFERENCES running_effort_projections(owner_id,activity_id,provider,id),
  CHECK ((status='unavailable' AND duration_s IS NULL AND start_offset_s IS NULL AND end_offset_s IS NULL AND reason IS NOT NULL)
    OR (status='estimated' AND method='summary_estimate' AND duration_s IS NOT NULL AND start_offset_s IS NULL AND end_offset_s IS NULL AND pause_coverage='summary')
    OR (status='calculated' AND method<>'summary_estimate' AND duration_s IS NOT NULL AND start_offset_s IS NOT NULL AND end_offset_s IS NOT NULL AND end_offset_s>start_offset_s AND duration_s<=end_offset_s-start_offset_s+0.000001 AND pause_coverage='validated' AND reason IS NULL)),
  CHECK (duration_s IS NULL OR (source_distance_m IS NOT NULL AND coverage_distance_m IS NOT NULL AND target_distance_m<=coverage_distance_m AND coverage_distance_m<=source_distance_m)),
  CHECK ((method='summary_estimate' AND pause_policy='summary_moving') OR (method='stream_calculated' AND pause_policy='moving_flags') OR (method='fit_calculated' AND pause_policy='timer_events'))
);
CREATE TABLE running_effort_heads (
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  activity_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('strava','garmin')),
  source_ref uuid NOT NULL,
  source_version char(64) NOT NULL CHECK (source_version ~ '^[a-f0-9]{64}$'),
  projection_id uuid,
  expected_resource_hash char(32) CHECK (expected_resource_hash ~ '^[a-f0-9]{32}$'),
  state text NOT NULL CHECK (state IN ('current','stale','failed')),
  failure_category text CHECK (failure_category IN ('retained_read_failed','projection_failed')),
  inspected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,activity_id,provider),
  FOREIGN KEY(owner_id,activity_id) REFERENCES activities(owner_id,id) ON DELETE CASCADE,
  FOREIGN KEY(owner_id,activity_id,provider,projection_id) REFERENCES running_effort_projections(owner_id,activity_id,provider,id)
);
CREATE TRIGGER check_effort_source BEFORE INSERT OR UPDATE OF source_ref,source_version,provider,activity_id ON running_effort_heads
  FOR EACH ROW EXECUTE FUNCTION sportos_check_activity_metric_source();
CREATE INDEX running_effort_history_lookup ON running_effort_projections(owner_id,activity_id,provider,projected_at DESC);
DO $$ DECLARE t text; r text; BEGIN
  FOREACH t IN ARRAY ARRAY['running_effort_projections','running_effort_values','running_effort_heads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY account_isolation ON %I TO sportos_app,sportos_worker_data USING (owner_id=sportos_current_account_id()) WITH CHECK (owner_id=sportos_current_account_id())',t);
    EXECUTE format('CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON %I FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change()',t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,sportos_data,sportos_legacy,sportos_worker,sportos_app,sportos_worker_data',t);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO sportos_app,sportos_worker_data',t);
    IF t='running_effort_heads' THEN
      EXECUTE format('GRANT UPDATE ON %I TO sportos_app,sportos_worker_data',t);
    ELSE
      EXECUTE format('CREATE TRIGGER reject_effort_history_mutation BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sportos_reject_garmin_history_mutation()',t);
    END IF;
    FOREACH r IN ARRAY ARRAY['sportos_worker','sportos_legacy','sportos_data'] LOOP
      IF has_table_privilege(r,t,'SELECT') OR has_table_privilege(r,t,'INSERT') OR has_table_privilege(r,t,'UPDATE') OR has_table_privilege(r,t,'DELETE') THEN RAISE EXCEPTION '% must not access %',r,t; END IF;
    END LOOP;
    FOREACH r IN ARRAY ARRAY['sportos_app','sportos_worker_data'] LOOP
      IF NOT has_table_privilege(r,t,'SELECT,INSERT') OR has_table_privilege(r,t,'DELETE') OR (t<>'running_effort_heads' AND has_table_privilege(r,t,'UPDATE')) OR (t='running_effort_heads' AND NOT has_table_privilege(r,t,'UPDATE')) THEN RAISE EXCEPTION 'Invalid effort privileges'; END IF;
    END LOOP;
  END LOOP;
END $$;
