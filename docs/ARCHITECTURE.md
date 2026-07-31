# Architecture

## Goal

Replace spreadsheet formulas with a canonical, auditable sports-data system while preserving import compatibility and traceability back to source workbooks.

```text
browser XLSX / local CLI / future integrations
                    |
                    v
       upload storage + uploaded_files
                    |
                    v
            import_jobs
                    |
                    v
          independent worker
                    |
                    v
       import_batches + source_records
                    |
                    v
 activities + daily_metrics + performance_events
                    |
                    v
       scoring_rules + score_ledger
                    |
                    v
     read-model views and repository queries
                    |
                    v
          NestJS API -> Angular UI
                    |
                    v
        future read-only AI tooling
```

## System boundary

The current system is a local-first, single-user monorepo. Postgres is the canonical metadata, job, provenance, and fact store. Uploaded workbook bytes live outside Postgres behind a storage contract. The API validates and stores browser uploads, then returns after durable enqueue. An independent worker claims jobs and executes the transactional importer.

The worker uses bounded Postgres polling. Redis remains provisioned for possible future wake-up acceleration but is not required for queue correctness. Authentication, user isolation, and hosted lifecycle policy belong to later milestones.

## Architectural invariants

1. **Raw input is retained before normalization.** Every successfully imported row should be recoverable with workbook, sheet, row, batch, and upload provenance.
2. **Canonical facts do not depend on a UI or API process.** Importers and domain logic are usable from worker, CLI, and tests.
3. **Official scores are deterministic.** An LLM may explain results but must not calculate or persist authoritative points.
4. **Every score is explainable.** A contribution identifies the rule, input metric, and calculation payload.
5. **Unknown source semantics are not guessed.** Ambiguous sheets or columns are skipped with warnings.
6. **Schema changes are versioned.** Flyway owns database evolution.
7. **Re-imports are idempotent.** Reprocessing creates a new auditable batch/raw snapshot but converges on the same canonical facts.
8. **Binary source files are external to Postgres.** Storage paths and keys remain internal.
9. **Untrusted filenames are presentation metadata only.** They never determine absolute storage paths.
10. **Postgres is authoritative for job execution.** Polling or future wake-up delivery cannot bypass the durable claim and lease.
11. **Only the current lease owner may progress or complete a job.** Stale workers cannot write terminal state after recovery.
12. **Cancellation occurs only at safe boundaries.** Running cancellation cooperatively rolls back the active import transaction; committed work is not relabelled cancelled.

## Layers

### Upload storage and metadata

Table:

- `uploaded_files`

The `UploadStorage` contract and local adapter live in `packages/importers` so API and worker share the same byte boundary. The local adapter writes opaque, mode-`0600` objects beneath `SPORTOS_UPLOAD_DIR`. A future object-store adapter must provide the same store/read/delete semantics.

`uploaded_files` records safe filenames, workbook kind, MIME signal, byte size, SHA-256, provider/object key, lifecycle status, and timestamps. Object keys are never exposed by upload, job, history, or diagnostic APIs. Retention and deletion behavior are defined in [ADR 0002](adr/0002-upload-storage-and-retention.md).

### Durable job orchestration

Table:

- `import_jobs`

The job row records upload and batch links, state, phase, monotonic progress, attempt limits, lease owner/expiry, heartbeat, cancellation request, result summary, sanitized terminal error, and timestamps.

Workers claim due jobs with `FOR UPDATE SKIP LOCKED`. Enqueue and retry use an advisory transaction lock to enforce the active queue limit. Lease-owner predicates guard progress, batch linking, and terminal writes. Expired running jobs are requeued, cancelled, or failed according to their persisted attempts and cancellation state.

The state machine and operational policy are defined in [ADR 0003](adr/0003-import-job-lifecycle.md).

### Raw provenance

Tables:

- `import_batches`
- `source_records`

Every import creates a durable batch failure envelope before its raw/canonical transaction. An uploaded batch links to `uploaded_files`; its job links to the current batch. Raw records are batch-scoped so repeated attempts remain inspectable. An exception rolls back raw/canonical writes while the batch envelope retains sanitized phase metadata.

### Canonical facts

Tables:

- `activities`
- `daily_metrics`
- `performance_events`

Spreadsheet layout and presentation conventions do not leak beyond the importer boundary. Canonical rows use deterministic source identities so retry or duplicate delivery converges on the same facts.

### Rules and explanations

Tables:

- `scoring_rules`
- `score_ledger`

Rules are persisted and versionable. The ledger records the contribution of each applied rule so a daily total can be reconciled with imported spreadsheet evidence.

### Read models

Views:

- `v_daily_summary`
- `v_score_breakdown`
- `v_performance_events`

The API and future AI tools prefer stable read models over ad hoc raw access.

## Package responsibilities

| Package or app | Responsibility |
|---|---|
| `apps/api` | HTTP boundary, upload validation/storage orchestration, durable enqueue, and job control endpoints |
| `apps/web` | Job-aware upload and review UI; no canonical business rules |
| `apps/worker` | Long-running bounded-concurrency job execution plus development CLI |
| `packages/shared` | Serialization schemas and low-level date/hash utilities |
| `packages/domain` | Pure sport, performance, aggregation, scoring, and reconciliation logic |
| `packages/db` | Typed schema, durable queue/lease operations, and repositories |
| `packages/importers` | Storage contract, XLSX extraction, normalization, warnings, and import orchestration |
| `packages/analytics` | Pure analytical helpers that do not require a database |
| `flyway/sql` | Append-only database migration history |

Dependency direction remains toward shared, pure packages. UI code must not become the only place where scoring or import semantics exist.

## Runtime flows

### Browser upload and enqueue

1. The browser posts one file plus an explicit workbook kind as multipart form data.
2. The API enforces one-file and 20 MB limits.
3. Validation checks `.xlsx`, MIME signal, ZIP signature, filename safety, and workbook readability.
4. The API computes SHA-256 and rejects a known non-deleted duplicate of the same workbook kind.
5. The shared storage adapter writes bytes under an opaque object key.
6. The API inserts `uploaded_files` metadata without binary content.
7. The API enqueues one durable `import_jobs` row, subject to one-active-job-per-upload and queue-depth constraints.
8. The API returns HTTP `202` with privacy-safe upload metadata and job state.

If enqueue fails, the API removes the newly stored object and marks the upload metadata deleted so no orphaned work is presented as active.

### Worker job flow

1. Recover expired running leases.
2. Claim one due queued job with `FOR UPDATE SKIP LOCKED`.
3. Assign a worker lease and increment the attempt.
4. Read the uploaded object and parse XLSX bytes in memory.
5. Invoke the existing transactional importer.
6. At importer phase boundaries, link the batch, check cancellation, persist monotonic progress, and extend the lease.
7. On success, mark the upload imported and the job succeeded with a result summary.
8. On failure, persist sanitized upload/job failure metadata.
9. On cooperative cancellation, roll back the active import transaction and mark the job cancelled.

### Import transaction

Each workbook attempt is processed as one logical import:

1. Create a durable `import_batch` failure envelope and link its upload.
2. Start a database transaction.
3. Persist batch-scoped raw `source_records`.
4. Parse known rows into canonical input types.
5. Upsert activities or performance events by deterministic cross-batch identity.
6. Recompute only affected daily dates.
7. Replace those dates' score-ledger entries deterministically.
8. Link canonical rows and normalized source records.
9. Update counts and final batch status.
10. Commit.

Any exception before commit rolls back raw/canonical writes. The batch envelope is marked failed outside the transaction with sanitized phase and attempted-count metadata. Identity, retry, backfill, and failure policy is recorded in [ADR 0001](adr/0001-import-transactions-and-identity.md).

### Query flow

1. The API validates route, query, and body parameters.
2. A repository queries a stable table or view.
3. Job APIs return persisted state without storage keys; history APIs return provenance without raw cells or paths.
4. The Angular UI renders job progress, history, diagnostics, and canonical review views.

## Why Flyway and Kysely

Flyway owns ordered SQL migrations. Kysely supplies typed queries and transactional job claims. Keeping those roles separate makes schema history explicit and avoids runtime schema mutation.

## Why not AI first

The source workbooks combine raw facts, formulas, coefficients, achievements, and presentation. Adding an LLM before canonical data, deterministic scoring, provenance, and operational workflows are stable would make results harder to reproduce and trust.

## Current risks

- Workbook assumptions are based on a small number of known files.
- Local upload storage is single-host and has no automated backup or lifecycle policy.
- Duplicate upload detection is advisory rather than a concurrent owner-scoped reservation.
- Postgres polling is intentionally simple but adds periodic database load; future wake-up acceleration must preserve the same claim/lease semantics.
- Authentication, ownership isolation, and hosted deletion workflows are not implemented.
- The current UI is a local cockpit rather than a complete multi-user product.

Milestone sequencing and exit criteria are tracked in [ROADMAP.md](ROADMAP.md).
