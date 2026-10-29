-- Explicit Garmin operations use the same durable database queue boundary as
-- other workers. Session plaintext never enters the API or dispatcher.
CREATE TABLE garmin_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
 status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','reauthorization_required','disconnected')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id), UNIQUE(owner_id,id)
);
CREATE TABLE garmin_credentials (
 owner_id uuid NOT NULL DEFAULT sportos_current_account_id(), connection_id uuid PRIMARY KEY,
 envelope_json jsonb NOT NULL CHECK(jsonb_typeof(envelope_json)='object' AND octet_length(envelope_json::text)<=262144
  AND envelope_json->>'algorithm'='aes-256-gcm' AND envelope_json->>'envelopeVersion'='1'
  AND envelope_json ?& ARRAY['keyId','nonce','ciphertext','authenticationTag']),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(owner_id,connection_id) REFERENCES garmin_connections(owner_id,id)
);
CREATE TABLE garmin_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT sportos_current_account_id(), connection_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('day','activity')),
 calendar_date date, activity_id uuid, refresh boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
 phase text NOT NULL DEFAULT 'queued' CHECK(length(phase)<=50),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_owner text CHECK(length(lease_owner)<=200), lease_expires_at timestamptz,
 cancellation_requested_at timestamptz, error_code text CHECK(length(error_code)<=80),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CHECK((operation='day' AND calendar_date IS NOT NULL AND activity_id IS NULL) OR (operation='activity' AND calendar_date IS NULL AND activity_id IS NOT NULL)),
 CHECK((status='running')=(lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
 FOREIGN KEY(owner_id,connection_id) REFERENCES garmin_connections(owner_id,id),
 FOREIGN KEY(owner_id,activity_id) REFERENCES activities(owner_id,id), UNIQUE(owner_id,id)
);
-- A session can rotate during a fetch. Serialize all work for that connection.
CREATE UNIQUE INDEX uq_garmin_active_connection ON garmin_jobs(connection_id) WHERE status IN ('queued','running');
CREATE INDEX idx_garmin_dispatch ON garmin_jobs(status,next_attempt_at,created_at);
-- Documented shared-system exception: no account, credential, host, source or
-- activity identifiers. API reads only freshness of a configured worker.
CREATE TABLE garmin_worker_status (
 worker_id text PRIMARY KEY CHECK(length(worker_id) BETWEEN 1 AND 200),
 ready boolean NOT NULL, checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garmin_worker_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE garmin_worker_status FORCE ROW LEVEL SECURITY;
CREATE POLICY capability_read ON garmin_worker_status FOR SELECT TO sportos_app,sportos_worker USING(true);
CREATE POLICY capability_write ON garmin_worker_status TO sportos_worker USING(true) WITH CHECK(true);
REVOKE ALL ON garmin_worker_status FROM PUBLIC,sportos_data,sportos_legacy,sportos_app,sportos_worker,sportos_worker_data;
GRANT SELECT ON garmin_worker_status TO sportos_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON garmin_worker_status TO sportos_worker;
DO $$DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['garmin_connections','garmin_credentials','garmin_jobs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY account_isolation ON %I TO sportos_app,sportos_worker_data USING(owner_id=sportos_current_account_id()) WITH CHECK(owner_id=sportos_current_account_id())',t);
  EXECUTE format('CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON %I FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change()',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,sportos_data,sportos_legacy,sportos_app,sportos_worker,sportos_worker_data',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON garmin_connections TO sportos_worker_data;
GRANT SELECT ON garmin_connections TO sportos_app;
GRANT UPDATE(status,updated_at) ON garmin_connections TO sportos_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON garmin_credentials TO sportos_worker_data;
GRANT DELETE ON garmin_credentials TO sportos_app;
GRANT SELECT,INSERT ON garmin_jobs TO sportos_app;
GRANT UPDATE(cancellation_requested_at,updated_at) ON garmin_jobs TO sportos_app;
GRANT SELECT,UPDATE ON garmin_jobs TO sportos_worker_data;
CREATE POLICY dispatch_jobs ON garmin_jobs TO sportos_worker USING(true) WITH CHECK(true);
GRANT SELECT ON garmin_jobs TO sportos_worker;
GRANT UPDATE(status,phase,attempt_count,next_attempt_at,lease_owner,lease_expires_at,error_code,updated_at,completed_at) ON garmin_jobs TO sportos_worker;
-- Retention workers have the same owner-scoped immutable evidence boundary.
ALTER POLICY account_isolation ON garmin_day_versions TO sportos_app,sportos_worker_data;
ALTER POLICY account_isolation ON garmin_day_heads TO sportos_app,sportos_worker_data;
GRANT SELECT,INSERT ON garmin_day_versions,garmin_day_heads TO sportos_worker_data;
GRANT UPDATE ON garmin_day_heads TO sportos_worker_data;
DO $$DECLARE t text;r text; BEGIN
 FOREACH t IN ARRAY ARRAY['garmin_credentials','garmin_connections','garmin_day_versions','garmin_day_heads','garmin_activity_identities'] LOOP
  IF has_table_privilege('sportos_worker',t,'SELECT') THEN RAISE EXCEPTION 'Dispatcher must not read %',t; END IF;
 END LOOP;
 IF has_table_privilege('sportos_app','garmin_credentials','SELECT') THEN RAISE EXCEPTION 'API must not read Garmin sessions'; END IF;
 FOREACH r IN ARRAY ARRAY['sportos_data','sportos_legacy'] LOOP
  IF has_table_privilege(r,'garmin_jobs','SELECT') OR has_table_privilege(r,'garmin_credentials','SELECT') THEN RAISE EXCEPTION 'Unexpected Garmin access for %',r; END IF;
 END LOOP;
 IF NOT has_table_privilege('sportos_worker_data','garmin_credentials','SELECT,UPDATE') OR has_table_privilege('sportos_worker_data','garmin_day_versions','UPDATE,DELETE') THEN RAISE EXCEPTION 'Invalid Garmin execution grants'; END IF;
END $$;
