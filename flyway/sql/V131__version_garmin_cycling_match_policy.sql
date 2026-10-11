-- Accept independently corroborated cycling identities under policy v4.
-- Preserve historical policies, established links, rejected decisions and scores.
ALTER TABLE garmin_reconciliation_audit
  DROP CONSTRAINT garmin_reconciliation_audit_policy_version_check;
ALTER TABLE garmin_reconciliation_audit
  ADD CONSTRAINT garmin_reconciliation_audit_policy_version_check
  CHECK (policy_version IN (1, 2, 3, 4));
-- Reconciliation is an explicit owner-scoped retained replay, never migration DML.
