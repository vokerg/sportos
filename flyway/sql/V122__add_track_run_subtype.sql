ALTER TABLE activities
  DROP CONSTRAINT activities_subtype_check;

ALTER TABLE activities
  ADD CONSTRAINT activities_subtype_check
  CHECK (subtype IN ('outdoor', 'indoor', 'treadmill', 'track', 'manual', 'race', 'unknown'));
