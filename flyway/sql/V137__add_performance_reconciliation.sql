-- Durable Excel/workout identity; independent of original times and scoring.
ALTER TABLE performance_events ADD CONSTRAINT uq_performance_events_owner_id UNIQUE (owner_id,id);
CREATE TABLE performance_match_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  event_id uuid NOT NULL,
  activity_id uuid,
  status text NOT NULL CHECK (status IN ('accepted','ambiguous','unmatched','rejected')),
  method text NOT NULL CHECK (method IN ('automatic','operator')),
  policy_version integer NOT NULL CHECK (policy_version BETWEEN 1 AND 10000),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (reason ~ '^[a-z][a-z_]{0,79}$'),
  diagnostics jsonb NOT NULL CHECK (jsonb_typeof(diagnostics)='array' AND jsonb_array_length(diagnostics)<=100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id,event_id,id),
  FOREIGN KEY (owner_id,event_id) REFERENCES performance_events(owner_id,id),
  FOREIGN KEY (owner_id,activity_id) REFERENCES activities(owner_id,id),
  CHECK ((status='accepted') = (activity_id IS NOT NULL))
);
CREATE TABLE performance_match_heads (
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  event_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  PRIMARY KEY (owner_id,event_id),
  FOREIGN KEY (owner_id,event_id,decision_id) REFERENCES performance_match_decisions(owner_id,event_id,id)
);
CREATE INDEX performance_matches_by_activity ON performance_match_decisions(owner_id,activity_id,event_id) WHERE activity_id IS NOT NULL;
CREATE FUNCTION sportos_check_performance_match() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM performance_events e WHERE e.owner_id=NEW.owner_id AND e.id=NEW.event_id AND e.source='run_db_xlsx') THEN
    RAISE EXCEPTION 'Historical performance record unavailable';
  END IF;
  IF NEW.activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM activities a
    JOIN provider_activity_links l ON l.owner_id=a.owner_id AND l.activity_id=a.id
    JOIN provider_connections c ON c.owner_id=l.owner_id AND c.id=l.connection_id
    WHERE a.owner_id=NEW.owner_id AND a.id=NEW.activity_id AND a.activity_type='run'
      AND l.availability='available' AND c.provider='strava'
  ) THEN RAISE EXCEPTION 'Running provider identity unavailable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_performance_match BEFORE INSERT ON performance_match_decisions FOR EACH ROW EXECUTE FUNCTION sportos_check_performance_match();
CREATE TRIGGER reject_performance_match_mutation BEFORE UPDATE OR DELETE ON performance_match_decisions FOR EACH ROW EXECUTE FUNCTION sportos_reject_garmin_history_mutation();
DO $$ DECLARE t text; r text; BEGIN
  FOREACH t IN ARRAY ARRAY['performance_match_decisions','performance_match_heads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY account_isolation ON %I TO sportos_app,sportos_worker_data USING (owner_id=sportos_current_account_id()) WITH CHECK (owner_id=sportos_current_account_id())',t);
    EXECUTE format('CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON %I FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change()',t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,sportos_data,sportos_legacy,sportos_worker,sportos_app,sportos_worker_data',t);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO sportos_app,sportos_worker_data',t);
    IF t='performance_match_heads' THEN EXECUTE format('GRANT UPDATE ON %I TO sportos_app,sportos_worker_data',t); END IF;
    FOREACH r IN ARRAY ARRAY['sportos_worker','sportos_legacy','sportos_data'] LOOP
      IF has_table_privilege(r,t,'SELECT') OR has_table_privilege(r,t,'INSERT') OR has_table_privilege(r,t,'UPDATE') OR has_table_privilege(r,t,'DELETE') THEN RAISE EXCEPTION 'Invalid performance reconciliation privileges'; END IF;
    END LOOP;
    FOREACH r IN ARRAY ARRAY['sportos_app','sportos_worker_data'] LOOP
      IF NOT has_table_privilege(r,t,'SELECT,INSERT') OR has_table_privilege(r,t,'DELETE') OR (t='performance_match_decisions' AND has_table_privilege(r,t,'UPDATE')) THEN RAISE EXCEPTION 'Invalid performance reconciliation privileges'; END IF;
    END LOOP;
  END LOOP;
END $$;
