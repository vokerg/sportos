-- Rebuildable compact GPS geometry in auxiliary detail DB; source/currentness checks
-- are enforced in the primary owner context (cross-database FK unavailable).
CREATE TABLE activity_route_projections (
 owner_id uuid NOT NULL DEFAULT sportos_activity_detail_current_account_id(),
 activity_id uuid NOT NULL,
 provider text NOT NULL CHECK (provider IN ('strava','garmin')),
 resolution text NOT NULL CHECK ((provider='strava' AND resolution IN ('streams','detail')) OR (provider='garmin' AND resolution='fit')),
 source_ref text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 200),
 source_version char(64) NOT NULL CHECK (source_version ~ '^[a-f0-9]{64}$'),
 resource_hash char(64) NOT NULL CHECK (resource_hash ~ '^[a-f0-9]{64}$'),
 algorithm_version integer NOT NULL CHECK (algorithm_version BETWEEN 1 AND 10000),
 polylines jsonb NOT NULL CHECK (jsonb_typeof(polylines)='array' AND jsonb_array_length(polylines) BETWEEN 1 AND 50 AND octet_length(polylines::text)<=60000),
 bounds jsonb NOT NULL CHECK (jsonb_typeof(bounds)='array' AND jsonb_array_length(bounds)=4),
 point_count integer NOT NULL CHECK (point_count BETWEEN 2 AND 3000),
 source_fetched_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'current' CHECK (state IN ('current','stale')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,activity_id)
);
ALTER TABLE activity_route_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_route_projections FORCE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON activity_route_projections TO sportos_app
 USING (owner_id=sportos_activity_detail_current_account_id())
 WITH CHECK (owner_id=sportos_activity_detail_current_account_id());
CREATE TRIGGER reject_owner_change BEFORE UPDATE OF owner_id ON activity_route_projections
 FOR EACH ROW EXECUTE FUNCTION sportos_activity_detail_reject_owner_change();
REVOKE ALL ON activity_route_projections FROM PUBLIC,sportos_app;
GRANT SELECT,INSERT,UPDATE ON activity_route_projections TO sportos_app;
DO $$
DECLARE r text;
BEGIN
 IF NOT has_table_privilege('sportos_app','activity_route_projections','SELECT,INSERT,UPDATE')
    OR has_table_privilege('sportos_app','activity_route_projections','DELETE') THEN
   RAISE EXCEPTION 'Invalid activity route projection grants';
 END IF;
 FOR r IN SELECT rolname FROM pg_roles
   WHERE rolname IN ('sportos_data','sportos_worker','sportos_worker_data','sportos_legacy')
 LOOP
  EXECUTE format('REVOKE ALL ON activity_route_projections FROM %I',r);
  IF has_table_privilege(r,'activity_route_projections','SELECT') OR has_table_privilege(r,'activity_route_projections','INSERT')
     OR has_table_privilege(r,'activity_route_projections','UPDATE') OR has_table_privilege(r,'activity_route_projections','DELETE') THEN
    RAISE EXCEPTION 'Non-API role % must not access route projections',r;
  END IF;
 END LOOP;
END $$;
