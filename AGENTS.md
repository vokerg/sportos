# AGENTS.md

This is the operational entry point for coding agents and maintainers working on SportOS.

## Current state

SportOS is a local-first single-user application for importing sports workbooks, retaining source bytes and raw rows, normalizing canonical facts, calculating deterministic scores, and reviewing results through a NestJS API and Angular UI.

Validated local capabilities include:

- reproducible workspace and fresh-database validation;
- sanitized XLSX fixtures;
- transactional and idempotent import orchestration;
- source-to-canonical traceability;
- deterministic scoring and reconciliation evidence;
- import history and row diagnostics;
- bounded browser upload and external source-file storage;
- durable import jobs with leases, progress, retry, cancellation, stale recovery, and independent worker execution;
- immutable scoring-rule versions, read-only impact previews, audited rule-change jobs, atomic recomputation, and Rules Studio;
- validated daily/performance date ranges, source drill-downs, responsive cockpit navigation, explicit loading/empty/error states, and strict canonical JSON export.

The next incomplete queue item is #14: authentication and per-user data ownership. Use the status vocabulary in `docs/ROADMAP.md`: **Implemented**, **Validated**, and **Operational**.

## Start here

1. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and the relevant ADRs.
2. Open issue #3, the authoritative work queue.
3. Check open pull requests and active claim comments.
4. Select the first ready unchecked issue.
5. Record the files inspected before implementation.

## Queue selection

Issue #3 is the sole source of truth for order. A ready issue is the first unchecked item, scanning P0 then P1 then P2, whose blockers are closed and which has no active implementation PR or claim.

When taking an issue:

1. comment `CLAIMED — branch: issue-<number>-<short-slug>`;
2. create the branch from current `main`;
3. keep one primary issue per PR;
4. open a draft PR early;
5. update the issue when blocked or when scope materially changes.

If blocked, record the exact blocker and required decision, leave the branch/PR safe, and select the next ready issue.

## Reprioritization

Do not infer priority from issue numbers. To reprioritize:

1. move the checklist item in issue #3;
2. comment with reason, date, and dependency impact;
3. update `Blocked by` and `Unblocks` sections;
4. notify any active claimant.

Data-integrity, privacy, and dependency failures may move to P0. Convenience work must not bypass provenance, idempotency, or deterministic-scoring defects without an ADR.

## Non-negotiable invariants

1. Raw input is retained before normalization with workbook, sheet, row, hash, upload, and batch provenance.
2. Uploaded bytes remain outside Postgres behind a replaceable contract; paths and object keys are private.
3. Unknown source semantics are not guessed.
4. Canonical facts are usable independently of the UI and API process.
5. Official scoring is deterministic domain logic; generated text never calculates or persists authoritative points.
6. Every ledger contribution identifies the exact rule UUID, inputs, points, and explanation payload.
7. Rule UUIDs are immutable semantic versions; enabled family ranges cannot overlap.
8. Preview is non-authoritative and cannot mutate official rules, totals, or ledger rows.
9. Rule publication and affected score replacement are atomic.
10. Re-importing identical data converges without duplicate canonical facts.
11. Flyway owns append-only schema evolution; Kysely types stay synchronized.
12. Postgres is authoritative for job state and leases; only the current lease owner may progress or complete work.
13. Running cancellation occurs only at documented safe boundaries.
14. Secrets, personal workbooks, storage keys, local paths, raw payloads, formulas, upload hashes, and unredacted exports are never committed or exposed.
15. Canonical exports have an explicit version, real inclusive dates, deterministic ordering, exact row counts, and explicit provenance status.
16. Dependencies point toward shared/pure packages; framework code does not leak into domain logic.

## Repository entry points

### Root workflow

- `package.json` — canonical workspace commands.
- `pnpm-workspace.yaml` — package boundaries.
- `.env.example` — database, worker, and upload settings.
- `docker-compose.yml` — Postgres, Redis, and Flyway.
- `.github/workflows/ci.yml` — migration, typecheck, unit/UI, DB jobs, worker jobs, importer integration, and build.
- `CONTRIBUTING.md` — change and validation rules.

### API: `apps/api`

- `src/main.ts` — Nest bootstrap.
- `src/app.module.ts` — controller/provider wiring.
- `src/db.provider.ts` — database lifecycle.
- `src/query-validation.ts` — real dates, bounded ranges/numbers, and UUID validation.
- `src/imports/imports.controller.ts` — upload, import jobs, history, diagnostics.
- `src/imports/imports.service.ts` — storage/enqueue orchestration.
- `src/rules/rules.controller.ts` — rule list, preview, activation, audit, retry, cancellation.
- `src/rules/rules.service.ts` — preview fingerprint and audit enqueue boundary.
- `src/daily/` — filtered daily summaries and persisted score breakdown.
- `src/performance/` — filtered events, trends, and source detail.
- `src/exports/` — bounded canonical export download.

API code validates and bounds inputs, orchestrates package services, and returns stable path-free error contracts. It must not reproduce importer or scoring rules.

### Web: `apps/web`

- `src/app/app.component.ts` — responsive cockpit composition and navigation.
- `src/app/api.service.ts` — HTTP contracts.
- `src/app/import-panel.component.ts` — upload and import-job monitoring.
- `src/app/rules-studio.component.ts` — immutable versions, preview, confirmation, rule-job monitoring, audit history.
- `src/app/daily-log.component.ts` — validated daily ranges, trends, reconciliation, and source drill-down.
- `src/app/score-breakdown-panel.component.ts` — ledger/rule/activity/source/batch explanation.
- `src/app/run-lab.component.ts` — distance/date trends, markers, event detail, and provenance.
- `src/app/export-panel.component.ts` — canonical JSON range download and row-count feedback.

Angular treats API responses as canonical. Do not calculate official scores, interpret workbooks, deduplicate facts, assemble export truth, or transition durable jobs in the browser.

### Worker: `apps/worker`

- `src/import-worker.ts` — long-running process and shutdown.
- `src/import-job-runner.ts` — workbook import leases.
- `src/rule-change-runner.ts` — audited rule publication/recomputation leases.
- `src/import-local.ts` — local CLI import.
- integration tests prove API-independent execution.

Worker orchestration stays thin. Import semantics belong in `packages/importers`; scoring and proposal semantics belong in `packages/domain`.

### Domain: `packages/domain`

- `src/scoring.ts` — authoritative deterministic scoring and ledger creation.
- `src/rules-studio.ts` — proposal normalization/validation and read-only preview.
- `src/reconciliation.ts` — spreadsheet/app reconciliation.
- `src/types.ts` — domain contracts.
- `src/daily.ts`, `performance.ts`, `units.ts` — pure helpers.

This package has no database, HTTP, Angular, NestJS, filesystem, provider SDK, or generated-text dependencies.

### Shared contracts: `packages/shared`

- `src/schemas.ts` — canonical importer inputs.
- `src/dates.ts` — real ISO-date and Excel-date utilities.
- `src/canonical-export.ts` — strict `sportos.canonical-export.v1` runtime contract.
- `src/canonical-export.test.ts` — date, ordering, row-count, strict-field, and provenance invariants.

Shared contracts may define serialization truth but must not query a database or depend on frameworks.

### Persistence: `packages/db`

- `src/schema.ts` — Kysely tables/views synchronized with migrations.
- `src/repositories/import-jobs.repository.ts` — import queue, leases, retry/cancel/recovery.
- `src/repositories/rule-changes.repository.ts` — immutable versions, overlap checks, audit leases, atomic activation/recomputation.
- `src/repositories/scoring.repository.ts` — active rule reads and runtime normalization.
- `src/repositories/daily.repository.ts` — activities, daily facts, ledger, and breakdown reads.
- `src/repositories/cockpit.repository.ts` — filtered daily read model.
- `src/repositories/performance.repository.ts` — performance lists/details and provenance.
- `src/repositories/canonical-export.repository.ts` — deterministic export assembly and privacy boundary.
- `src/repositories/imports.repository.ts`, `uploads.repository.ts` — remaining persistence boundaries.

Repositories own typed queries, serialization adapters, and transactions, not source interpretation.

### Import boundary: `packages/importers`

- `src/import-service.ts` — transactional import orchestration.
- `src/xlsx-reader.ts` — path/in-memory workbook extraction.
- `src/my-sport.importer.ts`, `run-db.importer.ts` — source interpretation.
- `src/upload-storage.ts` — shared byte contract and local adapter.
- `src/test-fixtures/xlsx-fixtures.ts` — deterministic fixtures.

Importer semantic changes require anonymized fixtures, malformed/ambiguous cases, warning evidence, duplicate safety, and mapping documentation.

### Migrations and decisions

- `flyway/sql/` — inspect all migrations before adding an append-only next version.
- `docs/adr/0001-import-transactions-and-identity.md`
- `docs/adr/0002-upload-storage-and-retention.md`
- `docs/adr/0003-import-job-lifecycle.md`
- `docs/adr/0004-rule-versioning-and-recomputation.md`
- `docs/CANONICAL_EXPORT.md`
- `docs/SPREADSHEET_MAPPING.md`
- `docs/SCORING_RULES.md`

## Change-specific requirements

### Imports and uploads

- validate size, extension, MIME signal, readability, filename, and traversal;
- retain raw rows before normalization;
- preserve batch/upload/source links;
- prove retries and duplicate delivery converge;
- never expose object keys or local paths.

### Scoring and Rules Studio

- keep calculations in `packages/domain`;
- validate activity, metric, unit, kind, coefficient/threshold, priority, and dates;
- preserve immutable historical UUIDs;
- reject overlapping enabled inclusive ranges in API and database;
- preview without persistence and confirm a freshness fingerprint;
- publish activation, daily totals, ledger UUIDs, and audit success atomically;
- prove rollback, cancellation, retry, and stale recovery;
- update ADR/scoring docs for semantic changes.

### Cockpit reads and export

- validate real inclusive dates, range ordering, maximum spans, numeric filters, pagination, and UUIDs before querying;
- normalize database `date` values to `YYYY-MM-DD` at repository boundaries;
- keep Daily Log and performance provenance linked to exact canonical/source/batch UUIDs;
- represent unavailable provenance as `missing` or `unsupported`, never inferred;
- assemble export datasets in repositories and validate the complete versioned envelope before returning;
- exclude raw cells, formulas, raw payload JSON, upload hashes, object keys, and paths;
- preserve deterministic ordering and exact declared row counts;
- cover loading, empty, error, retry, focus, keyboard, and responsive states.

### Database

- add an ordered Flyway migration only when schema changes are required;
- add constraints/indexes for new invariants and access paths;
- synchronize Kysely types;
- document backfill, rollback, and integrity impact;
- run fresh migration and database integration tests.

### API

- validate all route/query/body/file inputs;
- bound uploads, pagination, previews, exports, and date ranges;
- return stable actionable errors without private data;
- update README endpoint documentation and controller tests.

### Web

- cover loading, empty, error, progress, terminal, retry, cancel, and stale states;
- keep primary workflows keyboard accessible and responsive at common widths;
- add service/component tests;
- never duplicate official calculations or persistence truth.

### Jobs

- design for duplicate delivery and restart recovery;
- persist state, attempts, lease owner/expiry, progress, cancellation, result, and sanitized error;
- guard writes by current lease owner;
- define bounded concurrency, queue depth, attempts, and polling;
- keep committed success from being relabelled cancelled.

## Common commands

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm build
```

Development:

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:worker
```

Database integration uses a disposable database ending in `_test` or `-test`:

```bash
SPORTOS_TEST_DATABASE_URL=postgres://sportos:sportos@localhost:5432/sportos_test \
  pnpm --filter @sportos/db test:integration
SPORTOS_TEST_DATABASE_URL=postgres://sportos:sportos@localhost:5432/sportos_test \
  pnpm --filter @sportos/worker test:integration
SPORTOS_TEST_DATABASE_URL=postgres://sportos:sportos@localhost:5432/sportos_test \
  pnpm --filter @sportos/importers test:integration
```

Use pnpm only. Do not commit build output, caches, `.env`, uploaded files, or personal data.

## Investigation protocol

Before editing:

1. read the issue, dependencies, and linked PRs;
2. inspect the closest entry points, tests, and migrations;
3. identify the invariant and roadmap exit criterion advanced;
4. list all inspected files in the issue or PR;
5. call out code/documentation mismatches.

## Branch and PR rules

- Always branch from current `main`.
- Never commit directly to `main`.
- Do not merge unless a maintainer explicitly asks.
- When asked to merge, use squash merge.
- Keep one primary issue per PR.
- Open a draft PR early and link the issue.
- Do not silently expand scope; create or link follow-up work.

PR descriptions include problem, investigation files, implementation, architecture/milestone impact, validation evidence, migration/privacy/integrity implications, and limitations.

## Definition of done

A queue item is complete only when:

- acceptance criteria are satisfied;
- relevant domain, API, UI, migration, DB, worker, and importer tests pass;
- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass;
- documentation is current;
- integrity and privacy implications are addressed;
- the PR is merged;
- the linked issue is closed and issue #3 is updated.

If validation is incomplete, record exactly what was not run and do not describe the capability as validated or operational.
