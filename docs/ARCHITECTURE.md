# Architecture

## Goal

Replace spreadsheet formulas with a canonical, auditable sports-data system while preserving source provenance and deterministic score explanations.

```text
browser XLSX / local CLI / future integrations
                    |
                    v
       upload storage + uploaded_files
                    |
                    v
            import_jobs ------------------+
                    |                      |
                    v                      |
          independent worker <--- scoring_rule_changes
                    |                      |
                    v                      |
       import_batches + source_records     |
                    |                      |
                    v                      |
 activities + daily_metrics <--------------+
                    |
                    v
       scoring_rules + score_ledger
                    |
                    v
     read models -> NestJS API -> Angular UI
                    |
                    v
        future read-only AI tooling
```

## System boundary

SportOS is currently a local-first, single-user monorepo. Postgres is authoritative for metadata, job leases, audit history, provenance, canonical facts, rule versions, and official scores. Workbook bytes remain outside Postgres behind a replaceable storage contract.

The API validates and durably enqueues work. An independent worker executes import and rule-recomputation jobs. Bounded Postgres polling is sufficient for local correctness; future wake-up delivery may reduce latency but cannot bypass persisted claim and lease rules.

## Architectural invariants

1. Raw input is retained before normalization with workbook, sheet, row, batch, and upload provenance.
2. Canonical facts and official scoring do not depend on Angular or the API process.
3. Official points are deterministic domain output; generated text never calculates or persists them.
4. Every score contribution identifies the exact rule UUID, inputs, reason, and calculation payload.
5. Unknown source semantics are never guessed.
6. Flyway owns append-only schema evolution.
7. Re-imports converge on the same canonical facts without duplicates.
8. Uploaded bytes stay outside Postgres; storage keys and local paths are private.
9. Postgres is authoritative for job state and worker leases.
10. Only the current lease owner may progress or complete running work.
11. Cancellation occurs only at safe transactional boundaries.
12. A rule UUID is one immutable semantic version; family codes may repeat only across non-overlapping enabled ranges.
13. Preview is non-authoritative and cannot mutate rule rows, daily totals, or ledger entries.
14. Rule activation and affected score replacement publish atomically or not at all.

## Layers

### Upload storage and metadata

Table: `uploaded_files`

The shared `UploadStorage` contract and local adapter live in `packages/importers`. Local objects use opaque keys and mode-`0600` writes beneath `SPORTOS_UPLOAD_DIR`. Public contracts omit object keys, roots, paths, and raw bytes. See [ADR 0002](adr/0002-upload-storage-and-retention.md).

### Durable import jobs

Table: `import_jobs`

Import jobs persist upload/batch links, phase, monotonic progress, attempts, lease owner/expiry, heartbeat, cancellation, result, sanitized error, and lifecycle timestamps.

Workers claim with `FOR UPDATE SKIP LOCKED`. Advisory locking bounds enqueue/retry. Lease-owner predicates guard progress and terminal writes. Stale jobs are requeued, cancelled, or failed according to attempts and cancellation state. See [ADR 0003](adr/0003-import-job-lifecycle.md).

### Rule versions and audited recomputation

Tables:

- `scoring_rules`
- `scoring_rule_changes`
- `score_ledger`

`scoring_rules.code` identifies a family; `(code, version)` identifies its monotonic display version, while the UUID remains the immutable database identity. A GiST exclusion constraint prevents overlapping enabled inclusive date ranges within a family.

A proposed version is inserted disabled together with a durable `scoring_rule_changes` audit/job record. The audit stores actor, reason, previous/proposed UUIDs, complete proposal, preview, fingerprint, affected range, attempts, progress, result, and sanitized error.

The worker publishes one change in one transaction: close the superseded range when needed, enable the proposed UUID, recompute affected daily totals with domain scoring, replace ledger rows, and mark the audit succeeded. Any exception rolls the whole publication transaction back. See [ADR 0004](adr/0004-rule-versioning-and-recomputation.md).

### Raw provenance

Tables:

- `import_batches`
- `source_records`

Every import creates a durable batch failure envelope before the raw/canonical transaction. Raw records are batch-scoped, and uploaded batches retain their upload/job links. Exceptions roll back raw/canonical writes while retaining sanitized batch failure evidence.

### Canonical facts

Tables:

- `activities`
- `daily_metrics`
- `performance_events`

Spreadsheet layout does not cross the importer boundary. Deterministic source identities make retry and duplicate delivery converge on the same canonical rows.

### Read models

Views:

- `v_daily_summary`
- `v_score_breakdown`
- `v_performance_events`

The API and future read-only AI tools prefer stable read models and narrow repository contracts over ad hoc raw-table access.

## Package responsibilities

| Package or app | Responsibility |
|---|---|
| `apps/api` | HTTP validation, upload orchestration, import/rule enqueue, status, retry, and cancellation |
| `apps/web` | Review, import monitoring, server-computed rule preview, and audit UI; no authoritative calculations |
| `apps/worker` | Long-running import and rule-change execution plus local CLI |
| `packages/shared` | Serialization schemas and low-level date/hash utilities |
| `packages/domain` | Pure aggregation, scoring, reconciliation, rule validation, and preview logic |
| `packages/db` | Typed schema, leases, version/audit persistence, and repositories |
| `packages/importers` | Storage, XLSX extraction, normalization, warnings, and import transactions |
| `packages/analytics` | Pure analytics without database dependencies |
| `flyway/sql` | Append-only migrations and database constraints |

Dependencies point toward shared and pure packages. Angular and NestJS do not own scoring semantics.

## Runtime flows

### Browser upload

1. Validate one bounded XLSX upload and explicit workbook kind.
2. Reject unsupported, unreadable, oversized, or known duplicate content.
3. Store bytes under an opaque object key.
4. Insert safe upload metadata and one durable import job.
5. Return HTTP `202` with privacy-safe upload/job state.
6. Poll only while active, with a finite client budget.

### Import worker

1. Recover stale leases and claim one queued job.
2. Read the stored object and parse workbook bytes.
3. Invoke the transactional importer.
4. At safe phase boundaries, link the batch, check cancellation, persist progress, and extend the lease.
5. Mark success with result counts, or persist sanitized failure/cancellation state.

### Import transaction

1. Create and link a durable batch envelope.
2. Persist raw source records.
3. Normalize known rows and preserve warnings for ambiguity.
4. Upsert canonical facts by deterministic identity.
5. Recompute affected daily dates and replace their score ledger.
6. Commit batch counts/status and canonical links together.

See [ADR 0001](adr/0001-import-transactions-and-identity.md).

### Rules Studio preview

1. Validate and normalize the proposal in `packages/domain`.
2. Load enabled rule UUIDs, persisted daily facts, and canonical activities.
3. Apply the proposed version in memory only.
4. Score current and candidate sets with the same deterministic engine.
5. Return bounded date-level and aggregate deltas plus a confirmation fingerprint.

No authoritative row is written during preview.

### Rule activation and recomputation

1. Re-run preview and reject a stale fingerprint.
2. Insert the proposed disabled UUID and queued audit/job atomically.
3. The worker claims the change with a lease.
4. One transaction closes the superseded range, enables the new UUID, recomputes the bounded date range, replaces ledger entries, and completes the audit.
5. Failure rolls back all authoritative changes; retry reuses the same audit identity.

### Query flow

1. Validate route, query, body, file, and pagination inputs.
2. Query stable tables, views, or audit repositories.
3. Omit source-private storage details.
4. Render canonical facts, provenance, job state, rule history, previews, and audit results.

## Current risks

- Workbook assumptions are based on a small known sample.
- Local source storage is single-host and lacks automated backup/lifecycle policy.
- Duplicate upload detection is advisory rather than owner-scoped reservation.
- Postgres polling adds periodic load; wake-up acceleration must preserve durable claims.
- Rule recomputation is intentionally bounded to 5,000 persisted dates in one publication transaction; hosted-scale chunking needs a separate publication ADR.
- Authentication, ownership isolation, and hosted deletion are not implemented.
- The cockpit still lacks complete cross-screen drill-downs and canonical export.

Milestone sequencing is tracked in [ROADMAP.md](ROADMAP.md).
