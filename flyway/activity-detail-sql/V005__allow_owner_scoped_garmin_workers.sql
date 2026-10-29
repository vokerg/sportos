-- Separate detail database: a distinct worker-data login is required. Never
-- reuse primary credentials or let the queue dispatcher inspect source data.
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sportos_worker_data') THEN
  CREATE ROLE sportos_worker_data NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO sportos_worker_data;
GRANT EXECUTE ON FUNCTION sportos_activity_detail_current_account_id() TO sportos_worker_data;
DO $$DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['garmin_activity_resources','garmin_day_resources','activity_route_projections'] LOOP
  EXECUTE format('ALTER POLICY account_isolation ON %I TO sportos_app,sportos_worker_data',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO sportos_worker_data',t);
 END LOOP;
 -- Garmin route projection checks retained Strava privacy/geometry before using
 -- Garmin geometry. Read access does not grant Strava fetching or replacement.
 ALTER POLICY account_isolation ON activity_provider_resources TO sportos_app,sportos_worker_data;
 GRANT SELECT ON activity_provider_resources TO sportos_worker_data;
 GRANT UPDATE ON activity_route_projections TO sportos_worker_data;
 IF has_table_privilege('sportos_worker_data','garmin_activity_resources','UPDATE,DELETE') OR has_table_privilege('sportos_worker_data','garmin_day_resources','UPDATE,DELETE') THEN
  RAISE EXCEPTION 'Worker must preserve immutable Garmin resources';
 END IF;
END $$;
