-- Connect evidence is independent of CSV observations and canonical/scoring tables.
CREATE TABLE garmin_day_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  calendar_date date NOT NULL,
  category text NOT NULL CHECK (category IN ('summary','weight','sleep','heart_rate','hrv','stress','body_battery','activities')),
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  origin text NOT NULL DEFAULT 'garmin_connect' CHECK (origin = 'garmin_connect'),
  availability text NOT NULL CHECK (availability IN ('available','not_recorded','unsupported','private')),
  projection_json jsonb NOT NULL CHECK (octet_length(projection_json::text) <= 65536),
  retrieved_at timestamptz NOT NULL,
  UNIQUE (owner_id, calendar_date, category, source_hash),
  UNIQUE (owner_id, calendar_date, category, id)
);
CREATE TABLE garmin_day_heads (
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  calendar_date date NOT NULL,
  category text NOT NULL CHECK (category IN ('summary','weight','sleep','heart_rate','hrv','stress','body_battery','activities')),
  version_id uuid,
  state text NOT NULL CHECK (state IN ('available','not_recorded','unsupported','private','failed','authentication_required','rate_limited')),
  attempt_json jsonb NOT NULL DEFAULT '{}' CHECK (octet_length(attempt_json::text) <= 8192),
  attempted_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, calendar_date, category),
  FOREIGN KEY (owner_id, calendar_date, category, version_id)
    REFERENCES garmin_day_versions(owner_id, calendar_date, category, id),
  CHECK (state NOT IN ('available','not_recorded','private') OR version_id IS NOT NULL)
);
CREATE TRIGGER reject_history_mutation BEFORE UPDATE OR DELETE ON garmin_day_versions
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_garmin_history_mutation();
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['garmin_day_versions','garmin_day_heads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY account_isolation ON %I TO sportos_app USING (owner_id = sportos_current_account_id()) WITH CHECK (owner_id = sportos_current_account_id())', t);
    EXECUTE format('CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON %I FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change()', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, sportos_data, sportos_legacy, sportos_worker, sportos_worker_data, sportos_app', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO sportos_app', t);
  END LOOP;
  GRANT UPDATE ON garmin_day_heads TO sportos_app;
  FOREACH t IN ARRAY ARRAY['garmin_day_versions','garmin_day_heads'] LOOP
    IF NOT has_table_privilege('sportos_app', t, 'SELECT, INSERT') OR has_table_privilege('sportos_app', t, 'DELETE')
      OR (t = 'garmin_day_versions' AND has_table_privilege('sportos_app', t, 'UPDATE')) THEN
      RAISE EXCEPTION 'Garmin day grants invalid for %', t;
    END IF;
    FOREACH r IN ARRAY ARRAY['sportos_worker','sportos_worker_data','sportos_legacy','sportos_data'] LOOP
      IF has_table_privilege(r, t, 'SELECT') THEN RAISE EXCEPTION '% must not read %', r, t; END IF;
    END LOOP;
  END LOOP;
END;
$$;
