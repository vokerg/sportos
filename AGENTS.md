# AGENTS.md

This file is the operational entry point for coding agents and maintainers working on SportOS.

## Project state

SportOS is a local-first single-user application for importing sports workbooks, retaining source files and raw rows, normalizing canonical facts, calculating deterministic scores, and reviewing results through a NestJS API and Angular UI.

Trustworthy MVP-0 is complete. The usable local cockpit now includes:

- reproducible workspace and fresh-database validation;
- sanitized XLSX fixtures;
- transactional/idempotent import orchestration;
- end-to-end source-to-canonical traceability;
- explicit scoring semantics and reconciliation evidence;
- import history and row-level diagnostics;
- bounded browser upload backed by external source-file storage;
- durable asynchronous import jobs with leases, progress, retries, cancellation, stale recovery, and an independent worker.

The next incomplete queue item is Rules Studio and audited score recomputation. Do not describe a capability as delivered merely because source exists. Use the status vocabulary in `docs/ROADMAP.md`: **Implemented**, **Validated**, and **Operational**.

## Start here

1. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/FIRST_MILESTONE.md`, and `docs/ROADMAP.md`.
2. Open authoritative queue issue #3.
3. Check open pull requests and issue claim comments.
4. Select the first ready issue in queue order.

## Selecting work

Issue #3 is the sole source of truth for implementation order. A ready issue is the first unchecked item, scanning P0 then P1 then P2, whose blockers are closed and which has no active claim or implementation PR.

When taking an issue:

1. comment `CLAIMED — branch: issue-<number>-<short-slug>`;
2. create the branch from current `main`;
3. keep one primary issue per PR;
4. open a draft PR early;
5. record inspected files and material scope changes.

If blocked, document the exact blocker and required decision, leave the branch/PR safe, and select the next ready issue.

## Non-negotiable invariants

1. Raw input is retained before normalization with upload, workbook, sheet, row, hash, and batch provenance.
2. Uploaded bytes remain outside Postgres behind a replaceable storage contract. Storage roots, object keys, and local paths are not public API data.
3. Postgres is authoritative for job state and leases. Polling or future wake-up delivery never bypasses a durable claim.
4. Only the current lease owner may progress, link, or complete a running job.
5. Running cancellation occurs only at safe importer phase boundaries; committed work is not relabelled cancelled.
6. Unknown source semantics are never guessed. Persist raw input and emit warnings.
7. Canonical facts remain usable from worker, CLI, API, and tests without the web UI.
8. Official scoring is deterministic application logic. Generated text never calculates or persists authoritative points.
9. Every score contribution identifies its rule, inputs, points, and explanation payload.
10. Re-imports and retries converge on the same canonical state without duplicates.
11. Flyway owns schema evolution; Kysely types remain synchronized.
12. Personal workbooks, secrets, tokens, storage keys, paths, and unredacted exports are never committed or exposed.
13. Dependencies point toward shared/pure packages; framework and UI code do not leak into domain logic.

## Repository map and entry points

### Root workflow

- `package.json` — canonical commands and workspace validation.
- `pnpm-workspace.yaml` — workspace boundaries.
- `.env.example` — database, ports, upload root, worker concurrency, lease, and polling settings.
- `docker-compose.yml` — Postgres, Redis, and Flyway services. Redis is not required for current job correctness.
- `.github/workflows/ci.yml` — clean migration, typecheck, unit/UI tests, job/worker/import integration, and build.
- `CONTRIBUTING.md` — package and PR expectations.

### API: `apps/api`

- `apps/api/src/main.ts` — NestJS bootstrap.
- `apps/api/src/app.module.ts` — controllers, database provider, and storage registration.
- `apps/api/src/imports/imports.controller.ts` — upload/enqueue, job status/retry/cancel, history, diagnostics, and development local import.
- `apps/api/src/imports/imports.service.ts` — upload validation/storage, durable enqueue, and stable job errors.
- `apps/api/src/imports/workbook-upload.ts` — bounded XLSX trust-boundary validation.
- `apps/api/src/storage/*.ts` — compatibility re-exports of the shared storage boundary.
- `apps/api/src/daily/` — daily summary and score breakdown.
- `apps/api/src/performance/` — performance read endpoints.

API code validates and bounds user input, orchestrates package services, and returns stable privacy-safe contracts. It does not execute browser-upload imports or reproduce importer/scoring rules.

### Web: `apps/web`

- `apps/web/src/app/api.service.ts` — HTTP, multipart, and job contracts.
- `apps/web/src/app/import-panel.component.ts` — upload progress, bounded job polling, retry/cancel, history, and diagnostics.
- `apps/web/src/app/daily-log.component.ts` — daily reconciliation.
- `apps/web/src/app/run-lab.component.ts` — performance review.
- `apps/web/src/app/app.component.ts` — cockpit composition.

The web app renders canonical API state. Do not implement authoritative scoring, deduplication, workbook interpretation, or job transitions in Angular.

### Worker: `apps/worker`

- `apps/worker/src/import-worker.ts` — long-running process, signal shutdown, and bounded concurrency.
- `apps/worker/src/import-job-runner.ts` — stale recovery, claim, storage read, phase progress, cancellation, and terminal state.
- `apps/worker/src/import-job-runner.integration.test.ts` — real stored XLSX through independent worker completion.
- `apps/worker/src/import-local.ts` — development local-path CLI.
- `apps/worker/src/dry-run.ts` — parser inspection.

Worker orchestration stays thin. Import semantics belong in `packages/importers`; durable state transitions belong in `packages/db`.

### Import boundary: `packages/importers`

- `packages/importers/src/import-service.ts` — transactional import orchestration and phase boundaries.
- `packages/importers/src/upload-storage.ts` — framework-neutral storage contract and local adapter shared by API and worker.
- `packages/importers/src/xlsx-reader.ts` — path/in-memory extraction, rows, and hashes.
- `packages/importers/src/my-sport.importer.ts` — daily-ledger interpretation.
- `packages/importers/src/run-db.importer.ts` — running-workbook interpretation.
- `packages/importers/src/test-fixtures/` — synthetic/anonymized workbook evidence.

Importer semantic changes require fixtures, malformed/ambiguous cases, expected warnings, duplicate-safety evidence, and mapping documentation updates.

### Persistence: `packages/db`

- `packages/db/src/schema.ts` — Kysely table/view types.
- `packages/db/src/repositories/import-jobs.repository.ts` — queue limits, claims, leases, progress, cancellation, retry, and stale recovery.
- `packages/db/src/repositories/import-jobs.repository.integration.test.ts` — concurrency/lifecycle evidence.
- `packages/db/src/repositories/uploads.repository.ts` — uploaded-file lifecycle and batch linkage.
- `packages/db/src/repositories/imports.repository.ts` — batch/raw persistence and diagnostics.
- `packages/db/src/repositories/daily.repository.ts` — activities, daily metrics, ledger, and read models.
- `packages/db/src/repositories/scoring.repository.ts` — active scoring rules and runtime normalization.
- `packages/db/src/repositories/performance.repository.ts` — performance writes/queries.

Repositories own typed persistence and concurrency invariants, not workbook or scoring interpretation.

### Domain logic: `packages/domain`

- `packages/domain/src/scoring.ts` — deterministic scoring and ledger creation.
- `packages/domain/src/reconciliation.ts` — spreadsheet/app reconciliation.
- `packages/domain/src/types.ts` — canonical contracts.
- `packages/domain/src/daily.ts`, `performance.ts`, `units.ts` — pure domain helpers.

Keep the domain package pure: no database, HTTP, Angular, NestJS, filesystem, queue, provider SDK, or generated-text dependencies.

### Database migrations

Inspect all existing files in `flyway/sql` before adding one. Migrations are append-only, forward-compatible, explicit about constraints/indexes/backfills, and synchronized with `packages/db/src/schema.ts`.

Current operational decisions:

- `docs/adr/0001-import-transactions-and-identity.md`
- `docs/adr/0002-upload-storage-and-retention.md`
- `docs/adr/0003-import-job-lifecycle.md`
- `docs/SCORING_RULES.md`
- `docs/SPREADSHEET_MAPPING.md`

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

Development processes:

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:worker
```

Database integration:

```bash
SPORTOS_TEST_DATABASE_URL=postgres://sportos:sportos@localhost:5432/sportos_test \
  pnpm --filter @sportos/db test:integration
SPORTOS_TEST_DATABASE_URL=postgres://sportos:sportos@localhost:5432/sportos_test \
  pnpm --filter @sportos/worker test:integration
SPORTOS_TEST_DATABASE_URL=postgres://sportos:sportos@localhost:5432/sportos_test \
  pnpm --filter @sportos/importers test:integration
```

Development-only local import:

```bash
pnpm import:local -- \
  --mySport=/absolute/path/to/my_sport.xlsx \
  --runDb=/absolute/path/to/running-performance.xlsx
```

Use pnpm exclusively. Do not commit npm/Yarn lockfiles, framework caches, build output, local environment files, uploaded files, or personal workbook data.

## Investigation protocol

Before editing:

1. read the issue, dependencies, linked PRs, and current queue;
2. inspect the closest entry points and tests;
3. inspect existing migrations for the affected model;
4. identify the architecture invariant and roadmap criterion advanced;
5. list inspected files in the issue or PR.

Prefer current source over stale comments. When code and docs disagree, call out and fix the source of truth.

## Change-specific requirements

### Upload/storage

- Keep bytes outside Postgres unless an ADR explicitly changes that.
- Validate size, extension, MIME signal, readability, filename handling, and object-key traversal.
- Never expose storage roots, object keys, paths, or raw bytes.
- Define duplicate, partial-storage, failure, retention, and deletion behavior.
- Add contract and database-linkage evidence.

### Jobs

- Design for duplicate scans/delivery and retries.
- Persist state before returning success to the caller.
- Define queue limits, claims, leases, heartbeats, cancellation, attempts, stale recovery, and shutdown.
- Guard progress/batch/terminal writes by lease owner.
- Preserve upload and provenance context through execution.
- Prove independent worker completion, retry identity, cancellation, stale recovery, and idempotent canonical behavior.

### Importer/normalization

- Add fixture coverage before changing semantics.
- Persist raw rows before normalization.
- Preserve row/batch/upload traceability.
- Test malformed and unknown structures.
- Verify repeated imports and retries do not duplicate facts.
- Update spreadsheet mapping documentation.

### Scoring

- Add domain tests for normal and boundary cases.
- State units, rounding, thresholds, effective dates, and historical recomputation policy.
- Ensure ledger output identifies the applied rule and inputs.
- Provide reconciliation evidence when relevant.

### Database

- Add an ordered Flyway migration.
- Add constraints/indexes for new invariants and access paths.
- Keep Kysely types synchronized.
- Document backfill, recovery, and integrity impact.
- Run migration and database-backed tests.

### API and web

- Validate and bound all route/query/body/file inputs.
- Return actionable errors without leaking personal or storage data.
- Define/test response contracts and update endpoint docs.
- Cover loading, progress, empty, error, duplicate, retry, cancellation, terminal, and partial-provenance states.
- Keep primary workflows keyboard accessible.

### AI features

- Expose narrow read-only tools over stable views.
- Keep calculations deterministic outside the model.
- Require record/date/rule provenance in factual answers.
- Never grant generated text authoritative write access.

## Branch and pull-request rules

- Always branch from current `main`.
- Never commit directly to `main`.
- Do not merge unless a maintainer explicitly asks.
- When asked to merge, squash.
- Keep one primary issue per PR and open a draft early.
- Link the issue and state milestone impact.
- Do not silently expand scope; create or link follow-up work.

A PR description should include the problem, inspected files, implementation, architecture impact, validation evidence, migration/privacy/integrity implications, and known limitations.

## Definition of done

A queue item is done only when:

- issue acceptance criteria are satisfied;
- relevant unit, integration, contract, migration, and UI tests pass;
- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass;
- documentation is current;
- integrity and privacy implications are addressed;
- the PR is merged;
- the issue closes and queue issue #3 is updated.

Record exactly what was not run if validation is incomplete. Never present unverified behavior as validated or operational.
