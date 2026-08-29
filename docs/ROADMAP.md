# Roadmap

SportOS is sequenced by product risk: trustworthy facts and deterministic scores first, convenient workflows second, accounts/providers third, and read-only generated analysis only after stable authorized read models exist.

## Status vocabulary

- **Implemented**: source code exists.
- **Validated**: representative automated or repeatable evidence exists.
- **Operational**: observable failure handling supports repeated use without repository intervention.

A feature is not delivered solely because a component or table exists.

## Current baseline

| Area | Current state | Main remaining gap |
|---|---|---|
| Repository and fresh schema | Validated through V112 | routine maintenance and hosted backup/recovery |
| Raw provenance and imports | Validated and account scoped | hosted object lifecycle and deletion |
| Browser upload/storage | Validated and account scoped | hosted storage backup and erasure |
| Durable jobs | Import, provider-sync, and rule-change lifecycles validated | wake-up acceleration and hosted observability |
| Deterministic scoring | Validated and account scoped; imported workbook ledgers are authoritative until explicit recalculation | additional semantics only when evidence justifies them |
| Rules Studio | Validated with authenticated actor identity | hosted-scale recomputation |
| Score reconciliation | Validated on sanitized evidence | permitted historical evidence for unresolved workbook semantics |
| Cockpit review and export | Validated and account scoped | larger export delivery |
| Authentication and ownership | Validated with non-superuser RLS evidence | production OIDC/secret operations and account deletion policy |
| Provider ingestion | Strava connection, refresh, backfill, incremental sync, retry, disconnect, and provenance validated | webhook processing and additional providers |
| API | Authenticated, CSRF-protected, account scoped, and equipped with narrow cited analysis tools | hosted monitoring and external rate limiting |
| Web UI | Authenticated import, provider, review, rule, drill-down, analysis, and export workflows | broader provider portfolio and additional analysis tools |
| Hosted operation | Partially implemented | deployment, key management, backup, restoration, deletion, and observability |
| Read-only analysis | Validated with cited evidence, deterministic calculations, safe fallback, append-only audit metadata, evaluations, and UI separation | hosted model-gateway operations and broader semantic evaluation |

## Milestone 0: trustworthy local ingestion

Delivered:

- reproducible install, fresh migrations, tests, and builds;
- sanitized XLSX fixtures;
- source-row provenance and canonical links;
- transactional/idempotent imports and rollback;
- score breakdown and reconciliation;
- import history and row diagnostics;
- explicit scoring units, rounding, thresholds, priorities, effective dates, and base/bonus semantics;
- imported workbook `All` authority with visible imported/calculated row status, append-only score snapshots, and explicit Strava-backed recalculation;
- machine-readable exact/explained/unresolved evidence.

The detailed evidence is maintained in [FIRST_MILESTONE.md](FIRST_MILESTONE.md).

## Milestone 1: usable local cockpit

Delivered:

1. bounded browser upload and durable external source-file storage;
2. durable asynchronous import jobs and independent worker execution;
3. immutable rule versions, read-only previews, audited jobs, and atomic recomputation;
4. Daily Log and Run Lab drill-downs plus strict canonical export.

Milestone 1 was completed through issue #13.

## Milestone 2: accounts and integrations

Delivered account foundation:

- OIDC Authorization Code + PKCE without SportOS password storage;
- immutable internal account UUIDs and external `(issuer, subject)` identities;
- opaque server-side sessions with idle/absolute expiry and revocation;
- HttpOnly cookies, session-bound CSRF validation, and exact-origin credentialed CORS;
- explicit legacy-account backfill preserving all existing provenance/canonical UUIDs;
- non-null owner keys, account-scoped business constraints, and same-owner foreign keys;
- forced PostgreSQL row-level security exercised through non-superuser API/legacy roles;
- global worker claim with persisted owner propagation;
- authenticated Angular bootstrap, expiry handling, and safe sign-out;
- cross-user negative database and API evidence.

Delivered provider foundation:

- provider-neutral authorization, activity-page, refresh, revoke, error, and rate-limit contracts;
- application-encrypted credential envelopes with versioned AES-256-GCM keys and authenticated owner/connection context;
- durable owner-scoped provider connections, OAuth state, cursors, sync jobs, activity links, and bounded webhook inbox schema;
- separate dispatcher and owner-scoped worker-data authorization, with migration-time privilege assertions;
- Strava OAuth connection, rotating refresh tokens, initial backfill, incremental overlap sync, retries, rate-limit rescheduling, cancellation, and disconnect;
- raw provider activity retention before conservative normalization;
- deterministic provider identity plus explicit one-match/no-match/ambiguous workbook overlap behavior;
- browser connection, status, retry, cancellation, disconnect, provenance, and bounded polling states;
- fake-provider integration evidence for refresh, pagination, empty-page termination, retry convergence, and dispatcher denial.

See [ADR 0005](adr/0005-authentication-and-data-ownership.md), [ADR 0006](adr/0006-provider-ingestion-and-strava.md), and [AUTHENTICATION.md](AUTHENTICATION.md).

Remaining operational work:

1. production OIDC and Strava registration/secret provisioning;
2. webhook subscription verification and inbox processing;
3. additional providers and provider-specific fixtures;
4. time-zone/locale policy beyond conservative source-local dates;
5. hosted monitoring, backup/restoration, key-management-service integration, and audited account deletion.

Milestone 2 exit is satisfied for the first provider: a user can connect Strava, backfill or incrementally sync, and trace ownership/raw provenance for every normalized provider fact.

## Milestone 3: read-only analysis

Delivered:

- a fixed read-only tool allowlist over stable account-authorized daily and score-breakdown reads;
- strict dates, ranges, limits, question length, and exact request fields before repository execution;
- canonical date, activity, immutable rule UUID, score-ledger, source-record, and import-batch citations;
- deterministic totals, averages, extrema, first-to-last comparison, and official score calculations outside the generator;
- generated `observations`, `uncertainty`, and `suggestions` with observations restricted to returned citation keys;
- deterministic local fallback and an optional bounded operator-controlled HTTPS JSON generator;
- refusal of authoritative write requests and explicit medical/insufficient-data limitations;
- prompt-injection reduction by excluding imported narrative, filenames, hashes, rule names/descriptions, and rule-name-derived ledger reason text;
- append-only owner-scoped audit metadata without raw questions or generated answers;
- cross-account isolation evidence and evaluations for missing, conflicting, ambiguous, malicious, unsupported-write, and medical cases;
- an Angular entry point that visibly separates generated guidance from official SportOS evidence.

See [ADR 0007](adr/0007-read-only-ai-analysis.md) and [AI_ANALYSIS.md](AI_ANALYSIS.md).

Milestone 3 exit is satisfied: generated analysis can explain canonical data without authoritative calculation or write access.

## Near-term queue

Issue #3 remains authoritative. The ordered queue is complete through issue #16. New hosted operations, provider expansion, analysis tools, or product work must be added and prioritized explicitly rather than inferred from this completed sequence.

Each PR must identify the milestone or operational exit criterion it advances and include repeatable evidence appropriate to the risk.

## Accepted decisions

- [ADR 0001](adr/0001-import-transactions-and-identity.md) — import transactions and identity.
- [ADR 0002](adr/0002-upload-storage-and-retention.md) — source-file storage and retention.
- [ADR 0003](adr/0003-import-job-lifecycle.md) — durable import job lifecycle.
- [ADR 0004](adr/0004-rule-versioning-and-recomputation.md) — immutable rule versions, preview, audit, and atomic recomputation.
- [ADR 0005](adr/0005-authentication-and-data-ownership.md) — identity, sessions, database ownership, and worker context.
- [ADR 0006](adr/0006-provider-ingestion-and-strava.md) — provider adapters, encrypted credentials, durable synchronization, provenance, and cross-source identity.
- [ADR 0007](adr/0007-read-only-ai-analysis.md) — read tools, deterministic calculations, generated-answer validation, audit, and UI separation.
- [Canonical export v1](CANONICAL_EXPORT.md) — versioned canonical datasets, stable ordering, reconciliation, provenance states, and privacy exclusions.

See [ADR 0008](adr/0008-imported-ledger-authority-and-explicit-recalculation.md) for imported ledger authority, append-only score history, and explicit activity-based recalculation.

Future decisions still required include provider webhook operations, time-zone/locale policy, hosted observability, backup/restoration, key lifecycle, deletion, hosted model-gateway operations, broader semantic evaluation, and any expansion of the analysis tool surface.
