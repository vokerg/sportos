# ADR 0004: Versioned scoring rules and audited recomputation

- Status: proposed
- Date: 2026-07-31
- Issue: #12

## Context

SportOS currently stores one row per scoring-rule code. `scoring_rules.code` is globally unique, and the importer reads all enabled rows whose inclusive effective dates cover a daily metric. Score-ledger rows reference the applied rule UUID and persist calculation inputs, so historical explanations remain stable only while referenced rule rows are never mutated or deleted.

Rules Studio must allow safe changes without rewriting historical meaning, preview the impact before activation, recompute selected history through the durable worker lifecycle, and retain an audit trail explaining the proposal, activation, execution, and result.

## Proposed decision

### Immutable rule versions

A rule UUID identifies one immutable version. User-visible `code` identifies the rule family and may repeat across non-overlapping versions.

Existing rule rows remain queryable and are never updated in place after activation except for narrowly defined operational metadata that does not affect scoring semantics. A semantic change inserts a new row with a new UUID.

Each version stores or derives:

- rule family code;
- monotonic version number within the family;
- name and description;
- activity type and rule kind;
- metric and unit contract;
- coefficient or configured points;
- threshold operator, value, and unit;
- priority and enabled state;
- inclusive `valid_from` and `valid_to` dates;
- creation timestamp and initiating actor/context.

`score_ledger.rule_id` continues to reference the exact immutable version that produced each contribution.

### Effective ranges and overlap

Effective dates are inclusive. Within one rule family, active semantic versions may not overlap.

For two ranges `[a, b]` and `[c, d]`, overlap is rejected when both versions are enabled and the ranges intersect, including shared boundary dates. Open-ended `valid_to` is treated as infinity.

A new version may:

1. begin after the prior version ends; or
2. atomically close the prior open-ended version on the day before the new version begins and insert the new version.

Backdating is allowed only through an explicit preview-and-activate workflow. Silent retroactive insertion is rejected.

Database constraints, not only API validation, must prevent overlapping enabled ranges for a family.

### Validation contract

Validation belongs in shared domain/application code and is reused by preview and activation.

- `activity_type`, `rule_kind`, metric, threshold operator, and units must be from explicit supported sets;
- coefficients and threshold values must be finite and within documented bounds;
- coefficient rules require a coefficient and reject configured points;
- achievement rules require a threshold and non-zero configured points;
- manual rules require a supported metric and multiplier semantics;
- threshold unit must match the metric contract;
- `valid_from` and `valid_to` must be real ISO dates, with `valid_from <= valid_to`;
- priority must be a bounded integer;
- rule-family codes are stable identifiers and cannot be repurposed across incompatible activity/rule kinds without an explicit migration policy.

The browser performs convenience validation only. The API/domain layer remains authoritative.

### Change request and audit model

A rule change is represented by an immutable change request before it becomes authoritative.

The audit record stores:

- request ID and status;
- initiating actor/context (`local-user` until authentication exists);
- request timestamp;
- rule family and previous version ID when applicable;
- complete proposed version payload;
- requested affected date range;
- preview fingerprint and summary;
- activation timestamp and created version ID;
- recomputation job ID;
- terminal recomputation result or sanitized failure;
- cancellation/rollback metadata when applicable.

Proposed, activated, recomputing, completed, failed, and cancelled states remain queryable.

### Preview semantics

Preview is read-only and does not insert a rule version, mutate daily totals, or replace ledger rows.

The server:

1. validates the proposal and effective range;
2. constructs the candidate rule set by applying the proposal in memory;
3. loads persisted daily facts and canonical activities for the requested range;
4. scores each date with the current rule set and candidate rule set using `packages/domain`;
5. returns per-date current total, proposed total, delta, affected rule contributions, aggregate delta, affected-date count, and unchanged-date count;
6. persists a bounded preview summary and deterministic fingerprint on the change request so activation can prove which proposal/range was confirmed.

Preview results are not authoritative scores and are labelled accordingly.

### Activation and recomputation

Activation requires the exact preview fingerprint and proposal revision that the user confirmed.

From the user's perspective, activation and recomputation form one audited operation, but long-running score replacement executes through the durable worker lifecycle:

1. an activation transaction revalidates overlap and preview freshness;
2. it inserts the immutable new rule version, closes the prior version when requested, records the audit transition, and enqueues a recomputation job;
3. if enqueue fails, the activation transaction rolls back;
4. the worker recomputes the requested dates in bounded transactions using the now-authoritative effective rule set;
5. each date's `daily_metrics` totals and `score_ledger` entries are replaced atomically;
6. progress, cancellation, retry, stale recovery, and terminal state reuse the lease invariants from ADR 0003;
7. the audit record stores the terminal counts, aggregate delta, date range, and job reference.

A failed or cancelled recomputation does not delete the activated rule version. The audit view clearly reports partial/failed operational state and permits an idempotent retry for the same range. This avoids pretending an already-authoritative rule activation never occurred. The implementation must define bounded transaction granularity and expose which dates completed.

### Job lifecycle generalization

The V104 table and repository are upload/import-specific because `uploaded_file_id` is required and API routes are named import jobs. Rules recomputation needs the same durable state machine without a source upload.

The implementation should generalize the persistence and runner abstraction to support at least:

- `workbook_import` payloads linked to `uploaded_files`;
- `score_recompute` payloads linked to rule-change audit records and date ranges.

The generalized job record must preserve existing import-job IDs and API behavior. Job-kind-specific payloads are validated before enqueue and are never interpreted in the browser.

### Historical query semantics

Rules Studio lists all versions, including disabled/expired rows, ordered by family and effective range. Daily score breakdown continues to join the exact ledger rule UUID.

No bulk historical score is changed merely by creating or viewing a proposal. Only an activated change with an audited recomputation job replaces authoritative daily totals and ledger entries.

## Consequences

- Existing rule IDs and ledger explanations remain stable.
- The global unique constraint on `scoring_rules.code` must be replaced by family/version and non-overlap constraints.
- Rule rows become immutable semantic records rather than editable configuration rows.
- Preview can be computationally expensive and must use bounded date ranges and response limits.
- The durable job subsystem becomes reusable beyond workbook imports.
- Activation is transactionally coupled to job creation, while recomputation remains asynchronous and recoverable.
- Failed recomputation is visible and retryable rather than silently rolling back an already published rule version.

## Required evidence

The implementation must demonstrate:

- multiple non-overlapping versions of one rule family remain queryable;
- inclusive boundary overlap is rejected by API and database constraints;
- metric/unit/kind validation rejects invalid combinations;
- preview produces deterministic per-date and aggregate deltas without persistence;
- activation validates the confirmed preview fingerprint and atomically inserts the version plus recomputation job;
- worker recomputation replaces daily totals and ledger entries with the exact new rule UUID;
- failure, cancellation, retry, and stale recovery preserve audit state and canonical consistency;
- the Rules Studio UI covers list, edit proposal, preview, confirmation, progress, failure, and audit history;
- root validation and database-backed integration suites pass.
