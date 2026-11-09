-- Keep JSON geometry visibly distinct from FIT; existing RLS/grants unchanged.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='activity_route_projections'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%provider%resolution%' LOOP
 EXECUTE format('ALTER TABLE activity_route_projections DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE activity_route_projections ADD CONSTRAINT activity_route_projections_check
 CHECK ((provider='strava' AND resolution IN ('streams','detail')) OR (provider='garmin' AND resolution IN ('fit','json')));
