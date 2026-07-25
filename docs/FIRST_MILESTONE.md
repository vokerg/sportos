# MVP-0: spreadsheet ingestion and explainable daily scores

## Objective

Prove that SportOS can repeatedly import the existing training workbooks, preserve their source rows, normalize known facts, calculate deterministic daily scores, and explain differences from the spreadsheet totals.

MVP-0 is a trust and data-quality milestone. It is not a hosted product milestone.

## Implemented in the repository

- Docker Compose services for Postgres, Redis, and Flyway
- Flyway migrations for import, activity, scoring, performance, and read-model tables/views
- TypeScript domain types and deterministic scoring logic
- SheetJS workbook extraction helpers
- known-column mapping for the daily ledger workbook
- known-sheet mapping for the running performance workbook
- import orchestration through a local worker and API endpoint
- NestJS summary and performance endpoints
- Angular Daily Log, Run Lab, and local import panels
- preservation of imported spreadsheet totals for score reconciliation

These items describe source-code coverage. They do not by themselves prove that the system works reliably against all real workbook variants.

## Not yet proven

- a clean checkout can install, migrate, import, test, and build without manual repair;
- representative workbook fixtures cover the known layouts;
- importing the same workbook twice is idempotent;
- a partially invalid workbook produces useful warnings without corrupting prior data;
- source records, canonical rows, daily totals, and score-ledger entries reconcile end to end;
- score differences from the spreadsheet `All` column are understood;
- importer transactions and failure states are reliable;
- API validation and error responses are stable enough for the web app.

## MVP-0 exit criteria

MVP-0 can be considered complete when all of the following are true:

1. **Repeatable setup**: the documented setup works from a clean checkout with the pinned Node and pnpm versions.
2. **Reproducible CI**: install uses the committed pnpm lockfile, and typecheck, tests, and builds pass in CI.
3. **Fixture coverage**: sanitized or synthetic fixtures represent each supported daily-ledger and performance-sheet layout.
4. **Import traceability**: every canonical row can be traced to an import batch and source record where applicable.
5. **Idempotency**: re-importing identical source rows does not duplicate canonical activities, metrics, or performance events.
6. **Explainable reconciliation**: a date can show imported spreadsheet total, app total, delta, and the ledger entries that produced the app total.
7. **Conservative parsing**: unknown columns and sheets are reported as warnings and are not silently interpreted.
8. **Failure visibility**: import status and row-level warning/error counts are available for diagnosis.
9. **Documented assumptions**: workbook semantics and unresolved ambiguities are recorded in `SPREADSHEET_MAPPING.md`.

## Deferred until after MVP-0

- browser upload flow
- durable background job queue
- authentication and user accounts
- Strava, Garmin, Google Sheets, and FIT integrations
- Rules Studio UI
- advanced dashboards
- AI analyst
- XLSX export

## Recommended next PR sequence

1. Add sanitized importer fixtures and tests for the known workbook structures.
2. Add a score-breakdown API endpoint for a single date.
3. Add an expandable Daily Log row for `score_ledger` details and app-versus-Excel delta.
4. Make import deduplication and affected-date recomputation explicitly idempotent.
5. Add import history, warning/error detail, and transaction coverage.
6. Reconcile historical coefficients against the imported Excel `All` column.

The broader sequencing and later milestones are described in [ROADMAP.md](ROADMAP.md).
