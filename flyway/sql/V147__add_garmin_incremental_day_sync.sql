-- Owner-scoped progress only. No canonical/scoring DML or provider credentials.
ALTER TABLE garmin_connections ADD COLUMN sync_cursor_date date;
ALTER TABLE garmin_connections ADD COLUMN sync_cursor_at timestamptz;
ALTER TABLE garmin_connections ADD COLUMN sync_cursor_completed boolean NOT NULL DEFAULT false;
UPDATE garmin_connections SET
 sync_cursor_date=(now() AT TIME ZONE time_zone)::date-2,
 sync_cursor_at=(((now() AT TIME ZONE time_zone)::date-2)::timestamp AT TIME ZONE time_zone);
ALTER TABLE garmin_connections ALTER COLUMN sync_cursor_date SET NOT NULL;
ALTER TABLE garmin_connections ALTER COLUMN sync_cursor_date SET DEFAULT current_date-2;
ALTER TABLE garmin_connections ALTER COLUMN sync_cursor_at SET NOT NULL;
ALTER TABLE garmin_connections ALTER COLUMN sync_cursor_at SET DEFAULT date_trunc('day',now())-interval '2 days';
ALTER TABLE garmin_jobs ADD COLUMN sync_from date;
ALTER TABLE garmin_jobs ADD COLUMN sync_to date;
ALTER TABLE garmin_jobs ADD COLUMN sync_next_date date;
-- Replace only operation/target checks; preserve leases, ownership and status.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='garmin_jobs'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%operation%' LOOP
  EXECUTE format('ALTER TABLE garmin_jobs DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE garmin_jobs ADD CONSTRAINT garmin_operation_target CHECK (
 (operation='day' AND calendar_date IS NOT NULL AND activity_id IS NULL AND sync_from IS NULL AND sync_to IS NULL AND sync_next_date IS NULL)
 OR (operation='activity' AND calendar_date IS NULL AND activity_id IS NOT NULL AND sync_from IS NULL AND sync_to IS NULL AND sync_next_date IS NULL)
 OR (operation='sync' AND calendar_date IS NULL AND activity_id IS NULL AND sync_from IS NOT NULL AND sync_to IS NOT NULL
  AND sync_to>=sync_from AND sync_to-sync_from<=3660 AND sync_next_date IS NOT NULL AND sync_next_date BETWEEN sync_from AND sync_to+1));
CREATE OR REPLACE FUNCTION sportos_reject_garmin_job_target_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.connection_id,NEW.operation,NEW.calendar_date,NEW.activity_id,NEW.refresh,NEW.sync_from,NEW.sync_to)
   IS DISTINCT FROM ROW(OLD.connection_id,OLD.operation,OLD.calendar_date,OLD.activity_id,OLD.refresh,OLD.sync_from,OLD.sync_to) THEN
  RAISE EXCEPTION 'Garmin job targets are immutable';
 END IF;
 IF NEW.operation='sync' AND (NEW.sync_next_date<OLD.sync_next_date OR NEW.sync_next_date>OLD.sync_next_date+1) THEN
  RAISE EXCEPTION 'Garmin sync progress must advance one calendar day';
 END IF;
 RETURN NEW;
END $$;
-- API cannot advance the cursor or job progress. Existing table grants already
-- let owner-scoped workers checkpoint both under the fenced job transaction.
DO $$ BEGIN
 IF has_column_privilege('sportos_app','garmin_connections','sync_cursor_date','UPDATE')
  OR has_column_privilege('sportos_app','garmin_connections','sync_cursor_at','UPDATE')
  OR has_column_privilege('sportos_app','garmin_jobs','sync_next_date','UPDATE')
  OR has_table_privilege('sportos_worker','garmin_connections','SELECT') THEN
  RAISE EXCEPTION 'Garmin sync cursor must stay within worker-data authorization';
 END IF;
 IF NOT has_column_privilege('sportos_worker_data','garmin_connections','sync_cursor_date','UPDATE')
  OR NOT has_column_privilege('sportos_worker_data','garmin_jobs','sync_next_date','UPDATE') THEN
  RAISE EXCEPTION 'Garmin worker progress grants are missing';
 END IF;
END $$;
