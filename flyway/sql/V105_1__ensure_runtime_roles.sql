-- Existing Neon installations may not have provisioned every runtime role.
-- Create non-login placeholders so ownership migrations remain repeatable. The
-- Neon deployer must provision login capability and managed credentials before
-- starting runtime processes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_data') THEN
    CREATE ROLE sportos_data NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_app') THEN
    CREATE ROLE sportos_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION IN ROLE sportos_data;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_worker') THEN
    CREATE ROLE sportos_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION IN ROLE sportos_data;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_worker_data') THEN
    CREATE ROLE sportos_worker_data NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION IN ROLE sportos_data;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_legacy') THEN
    CREATE ROLE sportos_legacy NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION IN ROLE sportos_data;
  END IF;
END $$;
