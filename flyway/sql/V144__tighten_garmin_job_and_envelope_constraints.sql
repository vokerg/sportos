-- Missing JSON keys must fail rather than pass SQL CHECK's null semantics.
ALTER TABLE garmin_credentials ADD CONSTRAINT garmin_session_envelope_shape CHECK (
 envelope_json ?& ARRAY['algorithm','envelopeVersion','keyId','nonce','ciphertext','authenticationTag']
 AND envelope_json - ARRAY['algorithm','envelopeVersion','keyId','nonce','ciphertext','authenticationTag'] = '{}'::jsonb
 AND jsonb_typeof(envelope_json->'envelopeVersion')='number'
 AND jsonb_typeof(envelope_json->'algorithm')='string'
 AND jsonb_typeof(envelope_json->'nonce')='string'
 AND jsonb_typeof(envelope_json->'authenticationTag')='string'
 AND jsonb_typeof(envelope_json->'ciphertext')='string'
 AND jsonb_typeof(envelope_json->'keyId')='string'
 AND envelope_json->>'keyId' ~ '^[A-Za-z0-9._-]{1,100}$'
 AND envelope_json->>'nonce' ~ '^[A-Za-z0-9+/]{16}$'
 AND envelope_json->>'authenticationTag' ~ '^[A-Za-z0-9+/]{22}==$'
 AND envelope_json->>'ciphertext' ~ '^[A-Za-z0-9+/]+={0,2}$'
);
ALTER TABLE garmin_jobs ADD CONSTRAINT garmin_job_complete_lease CHECK (
 (status='running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
 OR (status<>'running' AND lease_owner IS NULL AND lease_expires_at IS NULL)
);
CREATE FUNCTION sportos_reject_garmin_job_target_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.connection_id,NEW.operation,NEW.calendar_date,NEW.activity_id,NEW.refresh)
   IS DISTINCT FROM ROW(OLD.connection_id,OLD.operation,OLD.calendar_date,OLD.activity_id,OLD.refresh) THEN
  RAISE EXCEPTION 'Garmin job targets are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reject_garmin_job_target_change BEFORE UPDATE ON garmin_jobs
 FOR EACH ROW EXECUTE FUNCTION sportos_reject_garmin_job_target_change();
