-- Explicit retained-data scoring. Provider acquisition cursors remain separate.
CREATE TABLE daily_recalculation_cursors (
 owner_id uuid PRIMARY KEY DEFAULT sportos_current_account_id() REFERENCES accounts(id),
 start_date date NOT NULL,
 time_zone text NOT NULL CHECK(length(time_zone) BETWEEN 1 AND 100),
 completed_through date,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(completed_through IS NULL OR completed_through >= start_date)
);
CREATE TABLE daily_recalculation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES daily_recalculation_cursors(owner_id),
 from_date date NOT NULL, to_date date NOT NULL, next_date date NOT NULL,
 time_zone text NOT NULL CHECK(length(time_zone) BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 lease_owner text CHECK(length(lease_owner) BETWEEN 1 AND 200), lease_expires_at timestamptz,
 cancellation_requested_at timestamptz,
 error_code text CHECK(error_code IN ('DAILY_DATA_UNAVAILABLE','DAILY_RECALCULATION_FAILED','RETRY_EXHAUSTED')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CHECK(to_date >= from_date AND to_date-from_date <= 3660 AND next_date BETWEEN from_date AND to_date+1),
 CHECK((status='running')=(lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
 UNIQUE(owner_id,id)
);
CREATE UNIQUE INDEX uq_daily_recalculation_active ON daily_recalculation_jobs(owner_id) WHERE status IN ('queued','running');
CREATE INDEX idx_daily_recalculation_dispatch ON daily_recalculation_jobs(status,created_at);
CREATE FUNCTION sportos_check_daily_recalculation_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.time_zone) THEN RAISE EXCEPTION 'Invalid scoring calendar'; END IF;
 IF TG_OP='UPDATE' AND (ROW(NEW.start_date,NEW.time_zone) IS DISTINCT FROM ROW(OLD.start_date,OLD.time_zone)
  OR (OLD.completed_through IS NOT NULL AND (NEW.completed_through IS NULL OR NEW.completed_through<OLD.completed_through))) THEN
  RAISE EXCEPTION 'Scoring cursor cannot move backwards or change calendar';
 END IF;
 IF NEW.completed_through >= (clock_timestamp() AT TIME ZONE NEW.time_zone)::date THEN
  RAISE EXCEPTION 'An unfinished calendar day cannot be completed';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_daily_recalculation_cursor BEFORE INSERT OR UPDATE ON daily_recalculation_cursors
 FOR EACH ROW EXECUTE FUNCTION sportos_check_daily_recalculation_cursor();
CREATE FUNCTION sportos_check_daily_recalculation_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.from_date,NEW.to_date,NEW.time_zone) IS DISTINCT FROM ROW(OLD.from_date,OLD.to_date,OLD.time_zone)
  OR NEW.next_date<OLD.next_date OR NEW.next_date>OLD.next_date+1 THEN
  RAISE EXCEPTION 'Scoring job target is immutable and progress advances one day';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_daily_recalculation_job BEFORE UPDATE ON daily_recalculation_jobs
 FOR EACH ROW EXECUTE FUNCTION sportos_check_daily_recalculation_job();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['daily_recalculation_cursors','daily_recalculation_jobs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY account_isolation ON %I TO sportos_app,sportos_worker_data USING(owner_id=sportos_current_account_id()) WITH CHECK(owner_id=sportos_current_account_id())',t);
  EXECUTE format('CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON %I FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change()',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,sportos_data,sportos_legacy,sportos_app,sportos_worker,sportos_worker_data',t);
 END LOOP;
END $$;
GRANT SELECT ON daily_recalculation_cursors TO sportos_app,sportos_worker_data;
GRANT INSERT(start_date,time_zone) ON daily_recalculation_cursors TO sportos_app,sportos_worker_data;
GRANT UPDATE(completed_through,updated_at) ON daily_recalculation_cursors TO sportos_worker_data;
GRANT SELECT ON daily_recalculation_jobs TO sportos_app,sportos_worker_data;
GRANT INSERT(from_date,to_date,next_date,time_zone) ON daily_recalculation_jobs TO sportos_app;
GRANT UPDATE(cancellation_requested_at,updated_at) ON daily_recalculation_jobs TO sportos_app;
GRANT UPDATE(status,next_date,attempt_count,lease_owner,lease_expires_at,error_code,updated_at,completed_at) ON daily_recalculation_jobs TO sportos_worker_data;
CREATE POLICY dispatch_jobs ON daily_recalculation_jobs TO sportos_worker USING(true) WITH CHECK(true);
GRANT SELECT ON daily_recalculation_jobs TO sportos_worker;
GRANT UPDATE(status,attempt_count,lease_owner,lease_expires_at,error_code,updated_at,completed_at) ON daily_recalculation_jobs TO sportos_worker;
DO $$ BEGIN
 IF has_table_privilege('sportos_worker','daily_recalculation_cursors','SELECT')
  OR has_column_privilege('sportos_app','daily_recalculation_cursors','completed_through','UPDATE')
  OR has_column_privilege('sportos_app','daily_recalculation_jobs','next_date','UPDATE')
  OR has_column_privilege('sportos_worker','daily_recalculation_jobs','next_date','UPDATE')
  OR NOT has_column_privilege('sportos_worker_data','daily_recalculation_cursors','completed_through','UPDATE') THEN
  RAISE EXCEPTION 'Invalid daily recalculation role boundary';
 END IF;
END $$;
