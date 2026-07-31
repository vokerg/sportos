# ADR 0004: Versioned scoring rules and audited recomputation

- Status: accepted
- Date: 2026-07-31
- Issue: #12

## Context

SportOS originally stored one row per scoring-rule code. `scoring_rules.code` was globally unique, so changing a coefficient or threshold would either mutate a row referenced by historical ledger entries or require inventing a new family code. Neither option provides trustworthy version history.

Rules Studio must preserve exact rule UUIDs, preview score effects without writes, reject invalid or overlapping definitions, activate a confirmed proposal through the durable worker lifecycle, and retain an audit trail for success, failure, retry, cancellation, and stale recovery.

## Decision

### Rule identity and versions

A rule UUID identifies one semantic version. The stable `code` identifies a rule family and may repeat across versions.

Each row stores a positive monotonic `version`, optional `supersedes_rule_id`, complete scoring configuration, inclusive effective dates, enabled state, and creation timestamp. Formula fields are never edited after the row is created. A superseding cutover may atomically shorten the prior version's effective end date to the day before the new version starts; this is the only scoring-semantic update permitted to an existing version and is recorded by the change audit.

`score_ledger.rule_id` continues to reference the exact UUID that produced each contribution. Historical versions remain queryable after cutover.

### Effective ranges

Effective dates are inclusive. Enabled versions in one family may not overlap, including a shared boundary date. Open-ended `valid_to` is treated as infinity.

Postgres enforces this with a GiST exclusion constraint over `(code, daterange(..., '[]'))`. The API also rejects overlaps early so users receive a stable conflict response.

A replacement must start after the selected prior version starts. During successful worker execution, an overlapping prior open-ended range is closed on the previous calendar day before the proposed row is enabled.

### Validation

`packages/domain/src/rules-studio.ts` is the authoritative proposal contract used by preview and activation.

It validates:

- stable lowercase family codes and bounded names/descriptions;
- supported activity types, rule kinds, metrics, and threshold operators;
- metric compatibility with activity type;
- finite positive coefficients for coefficient/manual rules;
- threshold value, exact metric unit, and positive integer points for achievement rules;
- real ISO calendar dates and ordered inclusive ranges;
- bounded integer priority;
- UUID shape for an optional replacement version.

Angular performs convenience input handling only. Official scoring remains in `packages/domain`.

### Preview

`POST /rules/preview` is read-only. It does not insert a rule, audit row, job, daily total, or ledger entry.

The API:

1. validates and normalizes the proposal;
2. loads enabled rule UUIDs plus persisted daily facts and canonical activities;
3. replaces the selected prior version in memory with the proposal;
4. invokes deterministic domain scoring for each available date in the requested effective range;
5. returns current/proposed base, bonus, total, and delta per date plus aggregate/minimum/maximum deltas;
6. computes a SHA-256 confirmation fingerprint over the normalized proposal, preview rows, current rule identities/effective ranges, and daily recomputation versions.

Preview is bounded to 5,000 persisted dates. Open-ended proposals preview through the latest persisted daily date. The fingerprint becomes stale when relevant rules or daily facts change.

### Activation and audit

`POST /rules/activate` requires the normalized proposal, an exact current preview fingerprint, and a non-empty audit reason.

One enqueue transaction:

1. locks the rule family and active-change boundary;
2. revalidates replacement identity and overlap;
3. inserts the new rule UUID disabled with the next family version;
4. inserts one `scoring_rule_changes` audit/job row containing actor, reason, proposal, preview, fingerprint, affected range, attempts, and lifecycle state.

If any insert or validation fails, neither row is committed.

The proposed version is deliberately non-authoritative while the audit job is queued or running.

### Worker recomputation

`scoring_rule_changes` uses the same durable lifecycle invariants as import jobs: queued/running/succeeded/failed/cancelled states, bounded attempts, `FOR UPDATE SKIP LOCKED` claims, lease owner, lease expiry, heartbeat, monotonic progress, explicit retry, queued cancellation, and stale recovery.

A separate typed table is used rather than weakening V104's required upload foreign key. Import-job IDs and API behavior remain unchanged while both job kinds share the same state-machine policy and run in the independent worker process.

For a claimed change, one Postgres transaction:

1. locks the audit row and proposed/prior rule rows;
2. aborts before activation when cancellation was already requested;
3. closes the selected prior range when necessary;
4. enables the proposed UUID;
5. reads the resulting enabled rule set;
6. recomputes each affected persisted date with domain scoring;
7. replaces that date's daily totals and score ledger entries;
8. records a succeeded audit result and terminal timestamps.

Any exception rolls the whole activation/recomputation transaction back. The prior rule, proposed disabled row, daily totals, and ledger remain in their pre-attempt state. The outer runner then records a sanitized failed terminal state, which can be retried with the same audit identity while attempts remain.

Queued cancellation is immediate. Running cancellation is cooperative before the activation transaction. Once the atomic transaction commits, a late cancellation cannot relabel the successful result.

### Audit queries

Rules Studio exposes:

- all rule versions, active and historical, ordered by family/version;
- recent change records with proposal, preview, actor, reason, range, status, attempts, progress, result, and sanitized error;
- one durable change status for bounded browser polling;
- retry and cancellation transitions.

No storage path, workbook cell payload, or other source-private data is included.

## Consequences

- Historical ledger explanations remain tied to immutable rule UUIDs.
- Family codes are reusable across non-overlapping versions.
- Preview can become stale and must be reconfirmed.
- Activation is not visible until recomputation succeeds atomically.
- A failed worker attempt leaves the new row disabled and authoritative scores unchanged.
- The local implementation uses one transaction for at most 5,000 persisted dates; larger hosted workloads require a new ADR for chunking and publication semantics.
- Authentication will replace the temporary `local-user` actor in issue #14 without changing audit identity.

## Evidence

The implementation is accepted only with repeatable evidence for:

- invalid proposal and inclusive-boundary validation;
- deterministic read-only preview deltas;
- database overlap rejection;
- single claims, stale recovery, cancellation, and retry identity;
- independent worker execution;
- atomic prior-range cutover, new-version activation, daily recomputation, and exact ledger UUID linkage;
- Rules Studio list/edit/preview/confirm/progress/failure/audit behavior;
- clean migration, typecheck, tests, integration suites, and production build.
