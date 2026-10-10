-- Walking is canonical training history, never a scoring-rule type.
ALTER TABLE activities DROP CONSTRAINT activities_activity_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type IN ('steps','walk','run','bike','swim','workout','rowing','sup','hiit','bonus'));
ALTER TABLE garmin_activity_identities DROP CONSTRAINT garmin_activity_identities_activity_type_check;
ALTER TABLE garmin_activity_identities ADD CONSTRAINT garmin_activity_identities_activity_type_check
  CHECK (activity_type IN ('walk','run','bike','swim','workout','rowing','sup'));
ALTER TABLE garmin_reconciliation_audit DROP CONSTRAINT garmin_reconciliation_audit_policy_version_check;
ALTER TABLE garmin_reconciliation_audit ADD CONSTRAINT garmin_reconciliation_audit_policy_version_check
  CHECK (policy_version IN (1,2,3));
-- Existing ownership, RLS, grants, links and immutable history remain intact.
-- No scores, ledger, snapshots, rules or retained source records are rewritten.
