-- V001 removed PUBLIC CONNECT and granted only the API login. Table/RLS grants
-- alone cannot let a dedicated worker open the separate detail database.
DO $$BEGIN
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO sportos_worker_data',current_database());
 IF NOT has_database_privilege('sportos_worker_data',current_database(),'CONNECT') THEN
  RAISE EXCEPTION 'Garmin worker-data requires detail database CONNECT';
 END IF;
END $$;
