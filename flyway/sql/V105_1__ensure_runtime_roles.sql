-- Existing installations may not have run the local Docker init scripts. Create
-- non-login placeholders so the ownership migration remains repeatable. A deployer
-- must grant LOGIN and a deployment-managed password, or replace them with login
-- roles that inherit from sportos_data, before starting runtime processes.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_legacy') THEN
    CREATE ROLE sportos_legacy NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION IN ROLE sportos_data;
  END IF;
END $$;
