# Roadmap

SportOS is sequenced by product risk: trustworthy facts and deterministic scores first, convenient workflows second, accounts/providers third, and AI analysis only after stable authorized read models exist.

## Status vocabulary

- **Implemented**: source code exists.
- **Validated**: representative automated or repeatable evidence exists.
- **Operational**: observable failure handling supports repeated use without repository intervention.

A feature is not delivered solely because a component or table exists.

## Current baseline

| Area | Current state | Main remaining gap |
|---|---|---|
| Repository and fresh schema | Validated | routine maintenance and hosted backup/recovery |
| Raw provenance and imports | Validated and account scoped | hosted object lifecycle and deletion |
| Browser upload/storage | Validated and account scoped | hosted storage backup and erasure |
| Durable import jobs | Validated and account aware | wake-up acceleration and hosted observability |
| Deterministic scoring | Validated and account scoped | additional semantics only when evidence justifies them |
| Rules Studio | Validated with authenticated actor identity | hosted-scale recomputation |
| Score reconciliation | Validated on sanitized evidence | permitted historical evidence for unresolved workbook semantics |
| Cockpit review and export | Validated and account scoped | larger export delivery |
| Authentication and ownership | Implemented with non-superuser RLS evidence | production OIDC/secret operations and account deletion policy |
| API | Authenticated, CSRF-protected, and account scoped | hosted monitoring and rate limiting |
| Web UI | Authenticated import, review, rule, drill-down, and export workflows | provider connection information architecture |
| Hosted operation | Partially implemented | deployment, backup, restoration, deletion, and observability |
| Integrations | Not implemented | provider adapters, credentials, cursors, deduplication |
| AI analysis | Intentionally not implemented | provider operations and authorized read-tool evaluation |

## Milestone 0: trustworthy local ingestion

Delivered:

- reproducible install, fresh migrations, tests, and builds;
- sanitized XLSX fixtures;
- source-row provenance and canonical links;
- transactional/idempotent imports and rollback;
- score breakdown and reconciliation;
- import history and row diagnostics;
- explicit scoring units, rounding, thresholds, priorities, effective dates, and base/bonus semantics;
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

### Delivered account foundation

- OIDC Authorization Code + PKCE without SportOS password storage;
- immutable internal account UUIDs and external `(issuer, subject)` identities;
- opaque server-side sessions with idle/absolute expiry and revocation;
- HttpOnly cookies, session-bound CSRF validation, and exact-origin credentialed CORS;
- explicit legacy-account backfill preserving all existing provenance/canonical UUIDs;
- non-null owner keys, account-scoped business constraints, and same-owner foreign keys;
- forced PostgreSQL row-level security exercised through non-superuser API/legacy roles;
- global worker claim with persisted owner propagation for imports and recomputation;
- authenticated Angular bootstrap, expiry handling, and safe sign-out;
- cross-user negative database and API evidence.

See [ADR 0005](adr/0005-authentication-and-data-ownership.md) and [AUTHENTICATION.md](AUTHENTICATION.md).

### Remaining ordered work

1. provider-neutral ingestion interfaces and first Strava adapter;
2. encrypted provider credentials and refresh handling;
3. provider cursors, rate limits, retries, and backfills;
4. cross-source identity and duplicate policy;
5. time-zone/locale policy, monitoring, backup, restoration, and audited deletion.

Exit: a user can safely connect a provider, backfill history, and trace ownership/provenance for every canonical fact.

## Milestone 3: read-only analysis

Work begins only after stable provider operations:

- narrow read-only tools over stable authorized views;
- cited dates, activities, rules, and source provenance;
- deterministic calculations outside the model;
- evaluations for hallucination, missing/conflicting data, and imported-text prompt injection;
- explicit separation of observations, uncertainty, suggestions, and official records.

Exit: generated analysis can explain canonical data without authoritative calculation or write access.

## Near-term queue

Issue #3 is authoritative. The sequence is:

1. provider ingestion and first Strava adapter;
2. read-only AI analysis.

Each PR must identify the milestone exit criterion it advances and include repeatable evidence appropriate to the risk.

## Accepted decisions

- [ADR 0001](adr/0001-import-transactions-and-identity.md) — import transactions and identity.
- [ADR 0002](adr/0002-upload-storage-and-retention.md) — source-file storage and retention.
- [ADR 0003](adr/0003-import-job-lifecycle.md) — durable import job lifecycle.
- [ADR 0004](adr/0004-rule-versioning-and-recomputation.md) — immutable rule versions, preview, audit, and atomic recomputation.
- [ADR 0005](adr/0005-authentication-and-data-ownership.md) — identity, sessions, database ownership, and worker context.
- [Canonical export v1](CANONICAL_EXPORT.md) — versioned canonical datasets, stable ordering, reconciliation, provenance states, and privacy exclusions.

Future decisions still required include provider identity/cursor policy, time-zone/locale policy, hosted observability, backup/restoration, deletion, and provider credential encryption.
