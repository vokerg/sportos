-- Local-development runtime roles. Production deployments must provision
-- equivalent non-superuser roles with deployment-managed credentials.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_data') THEN
    CREATE ROLE sportos_data NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_app') THEN
    CREATE ROLE sportos_app LOGIN PASSWORD 'sportos_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION IN ROLE sportos_data;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_worker') THEN
    CREATE ROLE sportos_worker LOGIN PASSWORD 'sportos_worker' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION IN ROLE sportos_data;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_worker_data') THEN
    CREATE ROLE sportos_worker_data LOGIN PASSWORD 'sportos_worker_data' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION IN ROLE sportos_data;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sportos_legacy') THEN
    CREATE ROLE sportos_legacy LOGIN PASSWORD 'sportos_legacy' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION IN ROLE sportos_data;
  END IF;
END $$;

ALTER ROLE sportos_legacy SET sportos.account_id = '00000000-0000-4000-8000-000000000001';
