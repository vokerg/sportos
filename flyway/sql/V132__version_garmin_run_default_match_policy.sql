-- Preserve every prior decision; no rematching or canonical/scoring writes.
ALTER TABLE garmin_reconciliation_audit
  DROP CONSTRAINT garmin_reconciliation_audit_policy_version_check;
ALTER TABLE garmin_reconciliation_audit
  ADD CONSTRAINT garmin_reconciliation_audit_policy_version_check
  CHECK (policy_version IN (1, 2, 3, 4, 5));
