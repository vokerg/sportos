-- Bounded scalar observations only. Original resources remain in the existing
-- detail database; canonical facts and official scoring are never rewritten.
CREATE TABLE activity_metric_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  activity_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('strava','garmin')),
  source_ref uuid NOT NULL,
  source_version char(64) NOT NULL CHECK (source_version ~ '^[a-f0-9]{64}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  parser_version integer NOT NULL CHECK (parser_version BETWEEN 1 AND 10000),
  state text NOT NULL CHECK (state IN ('processed','partial','stale')),
  rich_retained boolean NOT NULL,
  compact_only boolean NOT NULL,
  missing_count integer NOT NULL CHECK (missing_count BETWEEN 0 AND 200),
  rejected_count integer NOT NULL CHECK (rejected_count BETWEEN 0 AND 1000),
  value_count integer NOT NULL CHECK (value_count BETWEEN 0 AND 200),
  projected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, activity_id, provider, source_ref, source_version, input_hash, parser_version),
  UNIQUE (owner_id, activity_id, provider, id)
);
-- Historical activity UUIDs survive an explicit canonical deletion. Validate
-- owner membership on insert, as for existing reconciliation audits.
CREATE TRIGGER check_metric_activity_owner BEFORE INSERT ON activity_metric_projections
  FOR EACH ROW EXECUTE FUNCTION sportos_check_garmin_audit_activity_owner();
CREATE TABLE activity_provider_metric_values (
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  activity_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('strava','garmin')),
  projection_id uuid NOT NULL,
  metric_key text NOT NULL CHECK (metric_key ~ '^[a-zA-Z][a-zA-Z_]{0,63}$'),
  value double precision NOT NULL CHECK (value BETWEEN -100 AND 100000000),
  unit text NOT NULL CHECK (length(unit) BETWEEN 1 AND 32),
  source_kind text NOT NULL CHECK (source_kind IN ('compact','strava_detail','fit_session','strength_summary','canonical_fallback')),
  source_field text NOT NULL CHECK (length(source_field) BETWEEN 1 AND 80),
  source_unit text NOT NULL CHECK (length(source_unit) <= 32),
  origin text NOT NULL CHECK (origin IN ('recorded','provider_derived','calculated')),
  precedence integer NOT NULL CHECK (precedence BETWEEN 0 AND 100),
  PRIMARY KEY (owner_id,projection_id,metric_key,source_kind,source_field),
  FOREIGN KEY (owner_id,activity_id,provider,projection_id)
    REFERENCES activity_metric_projections(owner_id,activity_id,provider,id)
);
CREATE TABLE activity_metric_heads (
  owner_id uuid NOT NULL DEFAULT sportos_current_account_id() REFERENCES accounts(id),
  activity_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('strava','garmin')),
  source_ref uuid NOT NULL,
  source_version char(64) NOT NULL CHECK (source_version ~ '^[a-f0-9]{64}$'),
  projection_id uuid,
  expected_input_hash char(64) CHECK (expected_input_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('unprocessed','processed','partial','failed','stale')),
  rich_retained boolean,
  failure_category text CHECK (failure_category IN ('retained_read_failed','projection_failed')),
  inspected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id,activity_id,provider),
  FOREIGN KEY (owner_id,activity_id) REFERENCES activities(owner_id,id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id,activity_id,provider,projection_id)
    REFERENCES activity_metric_projections(owner_id,activity_id,provider,id)
);
-- Historical references cannot have live foreign keys: links may later be
-- explicitly rejected/deleted. Validate owner/source/activity/version membership
-- when publishing or changing a head, without blocking historical retention.
CREATE FUNCTION sportos_check_activity_metric_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider = 'strava' THEN
    IF NOT EXISTS (SELECT 1 FROM provider_activity_links l
      JOIN provider_connections c ON c.owner_id=l.owner_id AND c.id=l.connection_id
      JOIN source_records s ON s.owner_id=l.owner_id AND s.id=l.latest_source_record_id
      WHERE l.owner_id=NEW.owner_id AND l.id=NEW.source_ref AND l.activity_id=NEW.activity_id
        AND l.availability='available' AND c.provider='strava'
        AND s.source='strava_api' AND s.row_hash=NEW.source_version) THEN
      RAISE EXCEPTION 'Invalid provider source reference';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM garmin_activity_identities g
      WHERE g.owner_id=NEW.owner_id AND g.id=NEW.source_ref
        AND g.activity_id=NEW.activity_id AND g.current_hash=NEW.source_version) THEN
      RAISE EXCEPTION 'Invalid provider source reference';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_metric_source BEFORE INSERT ON activity_metric_projections
  FOR EACH ROW EXECUTE FUNCTION sportos_check_activity_metric_source();
CREATE TRIGGER check_metric_source BEFORE INSERT OR UPDATE OF source_ref,source_version,provider,activity_id ON activity_metric_heads
  FOR EACH ROW EXECUTE FUNCTION sportos_check_activity_metric_source();
CREATE INDEX activity_metric_projection_lookup ON activity_metric_projections(owner_id,activity_id,provider,projected_at DESC);
CREATE INDEX activity_metric_value_lookup ON activity_provider_metric_values(owner_id,activity_id,provider,projection_id);
DO $$ DECLARE t text; r text; BEGIN
  FOREACH t IN ARRAY ARRAY['activity_metric_projections','activity_provider_metric_values','activity_metric_heads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY account_isolation ON %I TO sportos_app,sportos_worker_data USING (owner_id = sportos_current_account_id()) WITH CHECK (owner_id = sportos_current_account_id())',t);
    EXECUTE format('CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON %I FOR EACH ROW EXECUTE FUNCTION sportos_reject_owner_change()',t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,sportos_data,sportos_legacy,sportos_worker,sportos_app,sportos_worker_data',t);
    EXECUTE format('GRANT SELECT,INSERT ON %I TO sportos_app,sportos_worker_data',t);
    IF t <> 'activity_metric_heads' THEN
      EXECUTE format('CREATE TRIGGER reject_metric_history_mutation BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sportos_reject_garmin_history_mutation()',t);
    ELSE
      EXECUTE format('GRANT UPDATE ON %I TO sportos_app,sportos_worker_data',t);
    END IF;
    FOREACH r IN ARRAY ARRAY['sportos_worker','sportos_legacy','sportos_data'] LOOP
      IF has_table_privilege(r,t,'SELECT') OR has_table_privilege(r,t,'INSERT') OR has_table_privilege(r,t,'UPDATE') OR has_table_privilege(r,t,'DELETE') THEN RAISE EXCEPTION '% must not access %',r,t; END IF;
    END LOOP;
    FOREACH r IN ARRAY ARRAY['sportos_app','sportos_worker_data'] LOOP
      IF NOT has_table_privilege(r,t,'SELECT,INSERT') OR has_table_privilege(r,t,'DELETE') OR (t <> 'activity_metric_heads' AND has_table_privilege(r,t,'UPDATE')) THEN RAISE EXCEPTION 'Invalid metric privileges'; END IF;
    END LOOP;
  END LOOP;
END $$;
