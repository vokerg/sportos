-- Compact identity/reconciliation only. Full Garmin representations belong in
-- the separate activity-detail project or replaceable blob storage.
CREATE TABLE garmin_activity_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  provider text NOT NULL DEFAULT 'garmin' CHECK (provider = 'garmin'),
  identity_key text NOT NULL CHECK (identity_key ~ '^(native:[0-9]{1,20}|fingerprint:v1:[0-9a-f]{64})$'),
  identity_kind text NOT NULL CHECK (identity_kind IN ('native', 'fingerprint_v1')),
  activity_id uuid,
  status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('exact', 'strong_unique', 'ambiguous', 'unmatched', 'manual', 'rejected')),
  activity_type text NOT NULL CHECK (activity_type IN ('run','bike','swim','workout','rowing','sup')),
  subtype text NOT NULL CHECK (subtype IN ('outdoor','indoor','treadmill','track','manual','race','unknown')),
  start_time timestamptz NOT NULL,
  elapsed_time_s double precision CHECK (elapsed_time_s BETWEEN 0 AND 604800),
  moving_time_s double precision CHECK (moving_time_s BETWEEN 0 AND 604800),
  distance_m double precision CHECK (distance_m BETWEEN 0 AND 1000000),
  current_hash char(64) NOT NULL CHECK (current_hash ~ '^[0-9a-f]{64}$'),
  source_updated_at timestamptz NOT NULL,
  match_evidence jsonb NOT NULL DEFAULT '{}' CHECK (octet_length(match_evidence::text) <= 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_garmin_activity_identity UNIQUE (owner_id, identity_key),
  CONSTRAINT uq_garmin_activity_owner_id UNIQUE (owner_id, id),
  CONSTRAINT garmin_activity_owner_activity_fk FOREIGN KEY (owner_id, activity_id) REFERENCES activities(owner_id, id),
  CONSTRAINT garmin_activity_link_status CHECK ((activity_id IS NOT NULL) = (status IN ('exact','strong_unique','manual'))),
  CONSTRAINT garmin_activity_identity_kind CHECK ((identity_kind = 'native') = (identity_key LIKE 'native:%'))
);
CREATE FUNCTION sportos_reject_garmin_identity_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider IS DISTINCT FROM OLD.provider OR NEW.identity_key IS DISTINCT FROM OLD.identity_key
    OR NEW.identity_kind IS DISTINCT FROM OLD.identity_kind THEN
    RAISE EXCEPTION 'Garmin provider identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reject_identity_change BEFORE UPDATE OF provider, identity_key, identity_kind ON garmin_activity_identities
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_garmin_identity_change();
CREATE INDEX idx_activities_reconciliation_start ON activities(owner_id, activity_type, start_time) WHERE start_time IS NOT NULL;

CREATE UNIQUE INDEX uq_garmin_activity_canonical ON garmin_activity_identities(owner_id, activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX idx_garmin_activity_pending_start ON garmin_activity_identities(owner_id, start_time, id) WHERE activity_id IS NULL AND status <> 'rejected';

CREATE TABLE garmin_activity_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  identity_id uuid NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  origin text NOT NULL CHECK (origin IN ('archive','connect')),
  source_updated_at timestamptz NOT NULL,
  -- An allowlisted normalized summary, never FIT/full JSON or narrative.
  summary_json jsonb NOT NULL CHECK (octet_length(summary_json::text) <= 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_garmin_activity_version UNIQUE (owner_id, identity_id, content_hash, origin),
  CONSTRAINT uq_garmin_activity_version_owner_id UNIQUE (owner_id, id),
  CONSTRAINT garmin_activity_version_identity_fk FOREIGN KEY (owner_id, identity_id) REFERENCES garmin_activity_identities(owner_id, id)
);

CREATE TABLE garmin_reconciliation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  identity_id uuid NOT NULL,
  activity_id uuid,
  action text NOT NULL CHECK (action IN ('auto_link','manual_link','reject','reopen')),
  policy_version integer NOT NULL CHECK (policy_version = 1),
  evidence_json jsonb NOT NULL CHECK (octet_length(evidence_json::text) <= 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT garmin_audit_identity_fk FOREIGN KEY (owner_id, identity_id) REFERENCES garmin_activity_identities(owner_id, id)
);

-- Audit UUIDs are immutable historical references, not live canonical links.
-- Check same-owner membership at insertion, permitting later canonical deletion
-- after explicit link rejection without mutating or deleting audit history.
CREATE FUNCTION sportos_check_garmin_audit_activity_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM activities WHERE owner_id = NEW.owner_id AND id = NEW.activity_id
  ) THEN RAISE EXCEPTION 'Invalid canonical activity reference'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER check_activity_owner BEFORE INSERT ON garmin_reconciliation_audit
  FOR EACH ROW EXECUTE FUNCTION sportos_check_garmin_audit_activity_owner();

CREATE FUNCTION sportos_reject_garmin_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Garmin provenance and reconciliation audit are append-only';
END;
$$;
CREATE TRIGGER reject_history_mutation BEFORE UPDATE OR DELETE ON garmin_activity_versions
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_garmin_history_mutation();
CREATE TRIGGER reject_history_mutation BEFORE UPDATE OR DELETE ON garmin_reconciliation_audit
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_garmin_history_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['garmin_activity_identities','garmin_activity_versions','garmin_reconciliation_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY account_isolation ON %I TO sportos_app, sportos_worker_data USING (owner_id = sportos_current_account_id()) WITH CHECK (owner_id = sportos_current_account_id())', t);
    EXECUTE format('CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON %I FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change()', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, sportos_data, sportos_legacy, sportos_worker, sportos_worker_data, sportos_app', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO sportos_app, sportos_worker_data', t);
  END LOOP;
END;
$$;
GRANT UPDATE ON garmin_activity_identities TO sportos_app, sportos_worker_data;

DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['garmin_activity_identities','garmin_activity_versions','garmin_reconciliation_audit'] LOOP
    IF NOT has_table_privilege('sportos_app', t, 'SELECT, INSERT') OR NOT has_table_privilege('sportos_worker_data', t, 'SELECT, INSERT') THEN
      RAISE EXCEPTION 'Owner-scoped runtime roles require access to %', t;
    END IF;
    FOREACH r IN ARRAY ARRAY['sportos_worker','sportos_legacy','sportos_data'] LOOP
      IF has_table_privilege(r, t, 'SELECT') THEN RAISE EXCEPTION '% must not read %', r, t; END IF;
    END LOOP;
    IF has_table_privilege('sportos_app', t, 'DELETE') OR (t <> 'garmin_activity_identities' AND has_table_privilege('sportos_app', t, 'UPDATE')) THEN
      RAISE EXCEPTION 'Runtime mutation privileges too broad for %', t;
    END IF;
  END LOOP;
END;
$$;
