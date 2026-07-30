# Architecture

## Goal

Replace spreadsheet formulas with a canonical, auditable sports-data system while preserving import compatibility and traceability back to the source workbooks.

```text
browser XLSX / local CLI / future integrations
                    |
                    v
       upload storage + uploaded_files
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

The current system is a local-first, single-user monorepo. Postgres is the canonical metadata/fact store. Uploaded workbook bytes live outside Postgres behind a storage contract, while upload metadata, raw rows, canonical facts, and scoring provenance remain queryable in Postgres.

The browser uses bounded multipart upload. The worker and development-only API endpoint may still import local workbook paths, but local paths are never part of the browser workflow or history/read-model responses. Durable background jobs, authentication, and user isolation belong to later milestones.

## Architectural invariants

These rules should remain true as the product grows:

1. **Raw input is retained before normalization.** Every successfully imported row should be recoverable with workbook, sheet, row, and batch provenance.
2. **Canonical facts do not depend on a UI.** Importers and domain logic must be usable from the API, worker, and tests.
3. **Official scores are deterministic.** An LLM may explain results but must not calculate or persist authoritative points.
4. **Every score is explainable.** A score contribution should identify the rule, input metric, and calculation payload that produced it.
5. **Unknown source semantics are not guessed.** Ambiguous sheets or columns are skipped with warnings until their meaning is confirmed.
6. **Schema changes are versioned.** Flyway migrations own database evolution; application startup must not mutate the schema implicitly.
7. **Re-imports are idempotent.** Reprocessing the same source data creates a new auditable batch/raw snapshot but converges on the same canonical facts.
8. **Binary source files are external to Postgres.** Storage paths/keys remain internal, while metadata and provenance stay durable and queryable.
9. **Untrusted filenames are presentation metadata only.** They never determine an absolute storage path and are never returned with server-local directories.

## Layers

### Upload storage and metadata

Table:

- `uploaded_files`

The `UploadStorage` contract separates byte persistence from import execution. The local adapter writes opaque, mode-`0600` objects beneath `SPORTOS_UPLOAD_DIR`. A future object-store adapter must provide the same store/read/delete semantics without changing importer rules.

`uploaded_files` records safe filenames, workbook kind, MIME signal, byte size, SHA-256, provider/object key, lifecycle status, and timestamps. The object key is internal and is not exposed by upload, history, or diagnostic APIs. Duplicate lookup uses SHA-256 plus workbook kind before a new import begins.

Retention and failure behavior are defined in [ADR 0002](adr/0002-upload-storage-and-retention.md).

### Raw provenance

Tables:

- `import_batches`
- `source_records`

Every successful import stores raw rows before canonical normalization. Raw records are batch-scoped so repeated imports remain inspectable. An uploaded batch links to `uploaded_files` through `import_batches.uploaded_file_id`. A failed attempt retains a durable failed batch with the file hash and sanitized phase metadata, while the rolled-back raw/canonical transaction leaves no partial rows.

### Canonical facts

Tables:

- `activities`
- `daily_metrics`
- `performance_events`

These tables are the application domain model. Spreadsheet layout, cell positions, and presentation conventions must not leak beyond the importer boundary. Canonical rows use deterministic source identities so identical rows from later batches update/reuse existing facts.

### Rules and explanations

Tables:

- `scoring_rules`
- `score_ledger`

Rules are persisted and versionable. The ledger records the contribution of each applied rule so a daily total can be reconciled with the imported spreadsheet total.

### Read models

Views:

- `v_daily_summary`
- `v_score_breakdown`
- `v_performance_events`

The API and future AI tools should prefer stable read models over ad hoc access to raw tables.

## Package responsibilities

| Package or app | Responsibility |
|---|---|
| `apps/api` | HTTP boundary, upload validation/storage orchestration, request validation, and lifecycle management |
| `apps/web` | Review and browser-upload UI; no canonical business rules |
| `apps/worker` | Local and future background import execution |
| `packages/shared` | Serialization schemas and low-level date/hash utilities |
| `packages/domain` | Pure sport, performance, aggregation, scoring, and reconciliation logic |
| `packages/db` | Typed database schema and repository queries |
| `packages/importers` | Source extraction, normalization, warnings, and import orchestration |
| `packages/analytics` | Pure analytical helpers that do not require a database |
| `flyway/sql` | Append-only database migration history |

Dependency direction should remain toward shared, pure packages. UI code must not become the only place where scoring or import semantics exist.

## Runtime flows

### Browser upload flow

1. The browser posts one file plus an explicit workbook kind as multipart form data.
2. The API enforces one-file and 20 MB limits.
3. Validation checks `.xlsx`, MIME signal, ZIP signature, filename safety, and workbook readability.
4. The API computes SHA-256 and rejects an existing non-deleted upload of the same workbook kind with `409 DUPLICATE_UPLOAD`.
5. The storage adapter writes the bytes under an opaque object key.
6. The API inserts `uploaded_files` metadata without storing binary content in Postgres.
7. The validated in-memory `WorkbookExtract` enters the normal transactional import flow.
8. The resulting import batch is linked to the upload metadata.
9. Success marks the upload imported. Failure retains the source object, marks the upload failed, and points the user to batch diagnostics.

### Import flow

Each workbook is processed as one logical import:

1. Create a durable `import_batch` failure envelope.
2. Link its upload metadata when the source came from browser storage.
3. Start a database transaction.
4. Persist batch-scoped raw `source_records`.
5. Parse known rows into canonical input types.
6. Upsert activities or performance events by deterministic cross-batch source identity.
7. Recompute only the daily dates affected by the workbook.
8. Replace those dates' score-ledger entries deterministically.
9. Link canonical rows and normalized source records.
10. Update counts and the successful final batch status.
11. Commit the transaction.

Any exception rolls back transactional raw/canonical writes. The batch envelope is then marked failed outside the rolled-back transaction with sanitized phase and attempted-count metadata. Separate workbooks in one local request use separate batches and transactions.

The identity, retry, backfill, and failure policy is recorded in [ADR 0001](adr/0001-import-transactions-and-identity.md).

### Query flow

1. The API validates route/query/body parameters.
2. A repository queries a stable table or view.
3. The API returns canonical data without reproducing spreadsheet formulas or storage paths.
4. The Angular UI renders review-oriented tables, charts, history, and diagnostics.

## Why Flyway and Kysely

Flyway owns schema evolution through ordered SQL migrations. Kysely supplies typed queries in application code. Keeping those responsibilities separate makes schema history explicit and avoids hiding database changes inside runtime code.

## Why not AI first

The source workbooks combine raw facts, formulas, coefficients, achievements, and presentation. Adding an LLM before those layers are separated would make results harder to reproduce and trust. AI belongs after canonical data, deterministic scoring, and stable read models are established.

## Current risks

- Workbook assumptions are based on a small number of known files.
- Local upload storage is single-host and has no automated backup or lifecycle policy.
- Duplicate detection is advisory rather than a concurrent owner-scoped reservation.
- Authentication, ownership isolation, asynchronous jobs, and hosted deletion workflows are not implemented.
- The current UI is a local cockpit rather than a complete multi-user product.

Milestone sequencing and exit criteria are tracked in [ROADMAP.md](ROADMAP.md).
