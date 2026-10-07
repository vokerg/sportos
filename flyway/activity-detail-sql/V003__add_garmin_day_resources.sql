-- Raw daily JSON precedes compact primary evidence; no cross-database FK.
CREATE TABLE garmin_day_resources (
  owner_id uuid NOT NULL DEFAULT sportos_activity_detail_current_account_id(),
  calendar_date date NOT NULL,
  category text NOT NULL CHECK (category IN ('summary','weight','sleep','heart_rate','hrv','stress','body_battery','activities')),
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  payload_json jsonb NOT NULL CHECK (octet_length(payload_json::text) <= 5242880),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, calendar_date, category, source_hash)
);
ALTER TABLE garmin_day_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE garmin_day_resources FORCE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON garmin_day_resources TO sportos_app
  USING (owner_id = sportos_activity_detail_current_account_id())
  WITH CHECK (owner_id = sportos_activity_detail_current_account_id());
CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON garmin_day_resources
  FOR EACH ROW EXECUTE FUNCTION sportos_activity_detail_reject_owner_change();
CREATE TRIGGER reject_resource_mutation BEFORE UPDATE OR DELETE ON garmin_day_resources
  FOR EACH ROW EXECUTE FUNCTION sportos_reject_garmin_resource_mutation();
REVOKE ALL ON garmin_day_resources FROM PUBLIC, sportos_app;
GRANT SELECT, INSERT ON garmin_day_resources TO sportos_app;
DO $$
DECLARE r text;
BEGIN
  IF NOT has_table_privilege('sportos_app', 'garmin_day_resources', 'SELECT, INSERT')
    OR has_table_privilege('sportos_app', 'garmin_day_resources', 'UPDATE')
    OR has_table_privilege('sportos_app', 'garmin_day_resources', 'DELETE') THEN
    RAISE EXCEPTION 'Garmin day resources must remain immutable';
  END IF;
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('sportos_data','sportos_worker','sportos_worker_data','sportos_legacy') LOOP
    EXECUTE format('REVOKE ALL ON garmin_day_resources FROM %I', r);
    IF has_table_privilege(r, 'garmin_day_resources', 'SELECT') THEN RAISE EXCEPTION '% must not read Garmin day details', r; END IF;
  END LOOP;
END;
$$;
