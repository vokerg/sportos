-- Short-lived mobile-browser PKCE handoff. Not an account-owned data table:
-- creation happens before login, approval assigns owner from the cookie session.
-- Access is limited to the API control-plane role; no shared/runtime worker access.
CREATE TABLE mobile_auth_requests (
  request_hash char(64) PRIMARY KEY CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  code_challenge varchar(43) NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  state varchar(128) NOT NULL CHECK (state ~ '^[A-Za-z0-9_-]{32,128}$'),
  approved_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash char(64) UNIQUE CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_approval_consistency CHECK (
    (approved_account_id IS NULL AND code_hash IS NULL AND approved_at IS NULL)
    OR (approved_account_id IS NOT NULL AND code_hash IS NOT NULL AND approved_at IS NOT NULL)
  )
);
CREATE INDEX idx_mobile_auth_requests_expiry ON mobile_auth_requests(expires_at);
ALTER TABLE mobile_auth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_auth_requests FORCE ROW LEVEL SECURITY;
-- The role is a trusted auth-control-plane role, analogous to auth_transactions.
CREATE POLICY mobile_auth_control_plane ON mobile_auth_requests TO sportos_app
  USING (true) WITH CHECK (true);
REVOKE ALL ON mobile_auth_requests FROM PUBLIC, sportos_data, sportos_legacy, sportos_worker, sportos_worker_data, sportos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON mobile_auth_requests TO sportos_app;
DO $$
BEGIN
  IF NOT has_table_privilege('sportos_app', 'mobile_auth_requests', 'SELECT, INSERT, UPDATE, DELETE')
    OR has_table_privilege('sportos_worker', 'mobile_auth_requests', 'SELECT')
    OR has_table_privilege('sportos_worker_data', 'mobile_auth_requests', 'SELECT')
    OR has_table_privilege('sportos_data', 'mobile_auth_requests', 'SELECT')
    OR has_table_privilege('sportos_legacy', 'mobile_auth_requests', 'SELECT') THEN
    RAISE EXCEPTION 'Mobile auth control-plane privileges are invalid';
  END IF;
END $$;
