-- Trusted API authentication control plane, like auth_transactions/mobile_auth_requests.
-- Pending requests have no owner. Only browser approval assigns an account/session.
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_account_id_id UNIQUE (account_id, id);
CREATE TABLE mcp_oauth_grants (
  request_hash char(64) PRIMARY KEY CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  client_id varchar(100) NOT NULL,
  redirect_uri varchar(500) NOT NULL,
  resource varchar(500) NOT NULL,
  scope text NOT NULL CHECK (scope = 'athlete:read'),
  code_challenge varchar(43) NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  state varchar(500) NOT NULL,
  account_id uuid,
  session_id uuid,
  code_hash char(64) UNIQUE CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
  token_hash char(64) UNIQUE CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  request_expires_at timestamptz NOT NULL,
  token_expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, session_id) REFERENCES auth_sessions(account_id, id) ON DELETE CASCADE,
  CHECK ((account_id IS NULL AND session_id IS NULL AND code_hash IS NULL)
    OR (account_id IS NOT NULL AND session_id IS NOT NULL AND code_hash IS NOT NULL)),
  CHECK ((token_hash IS NULL AND token_expires_at IS NULL)
    OR (token_hash IS NOT NULL AND token_expires_at IS NOT NULL AND account_id IS NOT NULL))
);
CREATE INDEX idx_mcp_oauth_grants_expiry ON mcp_oauth_grants(request_expires_at);
CREATE INDEX idx_mcp_oauth_grants_account ON mcp_oauth_grants(account_id);
ALTER TABLE mcp_oauth_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY mcp_auth_control_plane ON mcp_oauth_grants TO sportos_app
  USING (true) WITH CHECK (true);
REVOKE ALL ON mcp_oauth_grants FROM PUBLIC, sportos_data, sportos_legacy, sportos_worker, sportos_worker_data, sportos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_oauth_grants TO sportos_app;

CREATE FUNCTION sportos_protect_mcp_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.request_hash, NEW.client_id, NEW.redirect_uri, NEW.resource, NEW.scope,
      NEW.code_challenge, NEW.state, NEW.request_expires_at, NEW.created_at)
    IS DISTINCT FROM
     (OLD.request_hash, OLD.client_id, OLD.redirect_uri, OLD.resource, OLD.scope,
      OLD.code_challenge, OLD.state, OLD.request_expires_at, OLD.created_at)
    OR (OLD.account_id IS NOT NULL AND
      (NEW.account_id, NEW.session_id, NEW.code_hash) IS DISTINCT FROM (OLD.account_id, OLD.session_id, OLD.code_hash))
    OR (OLD.token_hash IS NOT NULL AND
      (NEW.token_hash, NEW.token_expires_at) IS DISTINCT FROM (OLD.token_hash, OLD.token_expires_at))
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'MCP authorization binding is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_mcp_grant BEFORE UPDATE ON mcp_oauth_grants
  FOR EACH ROW EXECUTE FUNCTION sportos_protect_mcp_grant();
DO $$
DECLARE role_name text;
BEGIN
  IF NOT has_table_privilege('sportos_app', 'mcp_oauth_grants', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'Missing MCP API privileges';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['sportos_worker','sportos_worker_data','sportos_data','sportos_legacy'] LOOP
    IF has_table_privilege(role_name, 'mcp_oauth_grants', 'SELECT, INSERT, UPDATE, DELETE') THEN
      RAISE EXCEPTION 'Unexpected MCP authentication privilege for %', role_name;
    END IF;
  END LOOP;
END $$;
