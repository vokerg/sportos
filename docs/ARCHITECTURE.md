# Architecture

## Goal

Replace spreadsheet formulas with a canonical, auditable sports-data system while preserving import compatibility and traceability back to the source workbooks.

```text
XLSX / future integrations / manual input
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

The current system is a local-first monorepo. Postgres is the canonical store. The worker and API can import local workbook paths, while the web app provides review screens over the API.

The current import endpoint is not a browser upload service. It expects paths available to the process running the API. Durable uploads, object storage, background jobs, retries, and user isolation belong to later milestones.

## Architectural invariants

These rules should remain true as the product grows:

1. **Raw input is retained before normalization.** Every successfully imported row should be recoverable with workbook, sheet, row, and batch provenance.
2. **Canonical facts do not depend on a UI.** Importers and domain logic must be usable from the API, worker, and tests.
3. **Official scores are deterministic.** An LLM may explain results but must not calculate or persist authoritative points.
4. **Every score is explainable.** A score contribution should identify the rule, input metric, and calculation payload that produced it.
5. **Unknown source semantics are not guessed.** Ambiguous sheets or columns are skipped with warnings until their meaning is confirmed.
6. **Schema changes are versioned.** Flyway migrations own database evolution; application startup must not mutate the schema implicitly.
7. **Re-imports are idempotent.** Reprocessing the same source data creates a new auditable batch/raw snapshot but converges on the same canonical facts.

## Layers

### Raw provenance

Tables:

- `import_batches`
- `source_records`

Every successful import stores raw rows before canonical normalization. Raw records are batch-scoped so repeated imports remain inspectable. A failed attempt retains a durable failed batch with the file hash and sanitized phase metadata, while the rolled-back raw/canonical transaction leaves no partial rows.

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
| `apps/api` | HTTP boundary, request validation, orchestration, and lifecycle management |
| `apps/web` | Review UI; no canonical business rules |
| `apps/worker` | Local and future background import execution |
| `packages/shared` | Serialization schemas and low-level date/hash utilities |
| `packages/domain` | Pure sport, performance, aggregation, and scoring logic |
| `packages/db` | Typed database schema and repository queries |
| `packages/importers` | Source extraction, normalization, warnings, and import orchestration |
| `packages/analytics` | Pure analytical helpers that do not require a database |
| `flyway/sql` | Append-only database migration history |

Dependency direction should remain toward shared, pure packages. UI code must not become the only place where scoring or import semantics exist.

## Runtime flows

### Import flow

Each workbook is processed as one logical import:

1. Create a durable `import_batch` failure envelope.
2. Start a database transaction.
3. Persist batch-scoped raw `source_records`.
4. Parse known rows into canonical input types.
5. Upsert activities or performance events by deterministic cross-batch source identity.
6. Recompute only the daily dates affected by the workbook.
7. Replace those dates' score-ledger entries deterministically.
8. Link canonical rows and normalized source records.
9. Update counts and the successful final batch status.
10. Commit the transaction.

Any exception rolls back steps 3–9. The batch envelope is then marked failed outside the rolled-back transaction with sanitized phase and attempted-count metadata. Separate workbooks in one request use separate batches and transactions.

The identity, retry, backfill, and failure policy is recorded in [ADR 0001](adr/0001-import-transactions-and-identity.md).

### Query flow

1. The API validates query parameters.
2. A repository queries a stable table or view.
3. The API returns canonical data without reproducing spreadsheet formulas.
4. The Angular UI renders review-oriented tables and charts.

## Why Flyway and Kysely

Flyway owns schema evolution through ordered SQL migrations. Kysely supplies typed queries in application code. Keeping those responsibilities separate makes schema history explicit and avoids hiding database changes inside runtime code.

## Why not AI first

The source workbooks combine raw facts, formulas, coefficients, achievements, and presentation. Adding an LLM before those layers are separated would make results harder to reproduce and trust. AI belongs after canonical data, deterministic scoring, and stable read models are established.

## Current risks

- Workbook assumptions are based on a small number of known files.
- Local-path imports are unsuitable for hosted or multi-user deployment.
- Score coefficients have not yet been fully reconciled against historical spreadsheet totals.
- API request validation and error contracts are minimal.
- The current UI is a review shell rather than a complete workflow.

Milestone sequencing and exit criteria are tracked in [ROADMAP.md](ROADMAP.md).
