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
| Raw provenance and imports | Validated and locally operational | ownership-scoped hosted operation |
| Browser upload/storage | Validated and locally operational | hosted object lifecycle and deletion |
| Durable import jobs | Validated and locally operational | wake-up acceleration and hosted observability |
| Deterministic scoring | Validated | additional rule semantics only when evidence justifies them |
| Rules Studio | Validated and locally operational | authentication-backed actor identity and hosted-scale recomputation |
| Score reconciliation | Validated on sanitized evidence | permitted historical evidence for unresolved workbook semantics |
| Cockpit review and export | Validated and locally operational | account-scoped authorization and larger export delivery |
| API | Validated local contracts | authentication and hosted authorization |
| Web UI | Validated local import, review, rule, drill-down, and export workflows | authenticated multi-user information architecture |
| Hosted/multi-user operation | Not implemented | auth, isolation, deployment, backup, deletion |
| Integrations | Not implemented | provider adapters, credentials, cursors, deduplication |
| AI analysis | Intentionally not implemented | stable authorized read tools and evaluation |

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

### Goal

A non-developer can import supported files, understand failures, inspect calculations, manage versioned rules safely, review performance and provenance, and repeat or export the workflow without filesystem paths or a CLI.

### Delivered

1. **Browser upload and durable storage** — bounded XLSX validation, external source bytes, durable metadata, duplicate detection, privacy-safe responses.
2. **Asynchronous import jobs** — persisted state, bounded queue/concurrency, worker leases, progress, retry, cancellation, stale recovery, independent execution.
3. **Rules Studio and audited recomputation** — immutable versions, inclusive non-overlap, domain validation, read-only date-level preview, confirmation fingerprints, durable audit jobs, atomic activation/recomputation, exact ledger UUIDs, retry/cancellation/recovery, and browser history.
4. **Cockpit drill-downs and canonical export** — validated inclusive ranges, Daily Log ledger/activity/source/batch drill-downs, Run Lab trends and event provenance, consistent loading/empty/error states, keyboard-visible navigation, and strict `sportos.canonical-export.v1` JSON.

### Exit criteria

Milestone 1 is complete when issue #13 is merged with clean contract, database provenance, API, component, integration, and production-build evidence.

## Milestone 2: accounts and integrations

Ordered work:

- authentication and user ownership;
- deployment, secrets, authorization, and hosted operational policy;
- provider-neutral ingestion interfaces;
- encrypted credentials and refresh handling;
- first Strava adapter;
- provider cursors, rate limits, retries, and backfills;
- cross-source identity and duplicate policy;
- time-zone/locale policy, monitoring, backup, and recovery.

Exit: a user can safely connect a provider, backfill history, and trace ownership/provenance for every canonical fact.

## Milestone 3: read-only analysis

Work begins only after stable authorization and provider operations:

- narrow read-only tools over stable views;
- cited dates, activities, rules, and source provenance;
- deterministic calculations outside the model;
- evaluations for hallucination, missing/conflicting data, and imported-text prompt injection;
- explicit separation of observations, uncertainty, suggestions, and official records.

Exit: generated analysis can explain canonical data without authoritative calculation or write access.

## Near-term queue

Issue #3 is authoritative. After the local cockpit milestone, the sequence is:

1. authentication and per-user ownership;
2. provider ingestion and first Strava adapter;
3. read-only AI analysis.

Each PR must identify the milestone exit criterion it advances and include repeatable evidence appropriate to the risk.

## Accepted decisions

- [ADR 0001](adr/0001-import-transactions-and-identity.md) — import transactions and identity.
- [ADR 0002](adr/0002-upload-storage-and-retention.md) — source-file storage and retention.
- [ADR 0003](adr/0003-import-job-lifecycle.md) — durable import job lifecycle.
- [ADR 0004](adr/0004-rule-versioning-and-recomputation.md) — immutable rule versions, preview, audit, and atomic recomputation.
- [Canonical export v1](CANONICAL_EXPORT.md) — versioned canonical datasets, stable ordering, reconciliation, provenance states, and privacy exclusions.

Future decisions still required include provider identity, time-zone/locale policy, authentication/session strategy, hosted observability, backup/restoration, and deletion.
