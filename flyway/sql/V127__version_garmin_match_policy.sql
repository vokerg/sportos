-- Preserve all policy-v1 audit rows. New decisions record the sport-aware v2.
ALTER TABLE garmin_reconciliation_audit
  DROP CONSTRAINT garmin_reconciliation_audit_policy_version_check;
ALTER TABLE garmin_reconciliation_audit
  ADD CONSTRAINT garmin_reconciliation_audit_policy_version_check CHECK (policy_version IN (1, 2));
