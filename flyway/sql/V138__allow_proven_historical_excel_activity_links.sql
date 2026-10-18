-- Keep historical Excel reconstruction independent of provider-native identity.
ALTER TABLE performance_match_decisions DROP CONSTRAINT performance_match_decisions_method_check;
ALTER TABLE performance_match_decisions ADD CONSTRAINT performance_match_decisions_method_check
  CHECK (method IN ('automatic','operator','historical'));
ALTER TABLE performance_match_decisions ADD CONSTRAINT historical_match_accepted_only
  CHECK (method <> 'historical' OR (status='accepted' AND policy_version=1 AND reason='historical_excel_reconstruction'));
CREATE OR REPLACE FUNCTION sportos_check_performance_match() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM performance_events e WHERE e.owner_id=NEW.owner_id AND e.id=NEW.event_id AND e.source='run_db_xlsx') THEN
    RAISE EXCEPTION 'Historical performance record unavailable';
  END IF;
  IF NEW.method='historical' THEN
    IF NOT EXISTS (
      SELECT 1 FROM activities a
      JOIN source_records s ON s.owner_id=a.owner_id AND s.id=a.source_record_id AND s.source=a.source
      JOIN performance_events e ON e.owner_id=a.owner_id AND e.id=NEW.event_id
      WHERE a.owner_id=NEW.owner_id AND a.id=NEW.activity_id AND a.activity_type='run'
        AND a.source IN ('my_sport_xlsx','run_db_xlsx') AND a.activity_date=e.event_date
        AND a.distance_m>=e.distance_m-least(10,e.distance_m*.001)
        AND (NOT e.is_treadmill OR a.subtype IN ('treadmill','unknown'))
    ) THEN RAISE EXCEPTION 'Historical workbook identity unavailable'; END IF;
  ELSIF NEW.activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM activities a
    JOIN provider_activity_links l ON l.owner_id=a.owner_id AND l.activity_id=a.id
    JOIN provider_connections c ON c.owner_id=l.owner_id AND c.id=l.connection_id
    WHERE a.owner_id=NEW.owner_id AND a.id=NEW.activity_id AND a.activity_type='run'
      AND l.availability='available' AND c.provider='strava'
  ) THEN RAISE EXCEPTION 'Running provider identity unavailable'; END IF;
  RETURN NEW;
END $$;
-- Existing forced RLS, same-owner FKs, immutable decisions and runtime grants
-- continue to apply; this migration introduces no owner or dispatcher grants.
