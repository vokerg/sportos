# AGENTS.md

This file is the operational entry point for coding agents and maintainers working on SportOS.

## Project state

SportOS is a local-first MVP-0 scaffold for importing sports workbooks, preserving raw provenance, normalizing canonical facts, calculating deterministic scores, and reviewing results through a NestJS API and Angular UI.

The first vertical slice exists, but it is not yet production-ready. The main unproven areas are:

- representative workbook fixture coverage;
- import idempotency and transaction safety;
- end-to-end source-to-canonical traceability;
- score-ledger reconciliation against spreadsheet totals;
- import history and failure diagnostics;
- stable API validation/error contracts.

Do not describe a capability as delivered merely because source code exists. Use the status vocabulary in `docs/ROADMAP.md`: **Implemented**, **Validated**, and **Operational**.

## Start here

1. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/FIRST_MILESTONE.md`, and `docs/ROADMAP.md`.
2. Open the authoritative [work queue](https://github.com/vokerg/sportos/issues/3).
3. Check open pull requests for work already implementing a queue item.
4. Resolve or explicitly supersede draft PR #1 before starting the first feature issue; its Vitest upgrade still needs a regenerated lockfile and validation.
5. Select the first ready issue using the algorithm below.

## Selecting the next issue

Issue #3 is the sole source of truth for implementation order.

A ready issue is the first unchecked item, scanning P0 then P1 then P2, that satisfies all of these conditions:

- the issue is open;
- every issue listed under `Blocked by` is closed;
- no open pull request is already implementing it;
- no active claim comment indicates another agent is working on it.

When taking an issue:

1. comment `CLAIMED — branch: issue-<number>-<short-slug>` on the issue;
2. create the branch from the current `main` branch;
3. use the branch name `issue-<number>-<short-slug>`;
4. keep one primary issue per pull request;
5. open a draft pull request early and link the issue;
6. update the issue when blocked or when scope materially changes.

If work becomes blocked, document the exact blocker and required decision. Leave the branch and pull request in a safe state, then select the next ready issue from issue #3.

## Reprioritization

Do not infer priority from issue numbers or title identifiers. The checklist order in issue #3 is authoritative.

To reprioritize:

1. move the item to the desired bucket and position in issue #3;
2. comment on issue #3 with the reason, date, and dependency impact;
3. update `Blocked by` and `Unblocks` sections on affected issues;
4. notify any agent with an active claim on displaced work.

Emergency dependency, data-integrity, or privacy work may move to the top of P0. Convenience features must not bypass unresolved provenance, idempotency, or deterministic-scoring defects without an explicit architecture decision.

## Non-negotiable invariants

Preserve these constraints across all changes:

1. Raw input is retained before normalization, with workbook, sheet, row, hash, and batch provenance.
2. Unknown source semantics are never guessed. Persist the raw row and emit a warning.
3. Canonical facts do not depend on the web UI and remain usable from API, worker, and tests.
4. Official scoring is deterministic application logic. AI-generated text never calculates or persists authoritative points.
5. Every persisted score contribution identifies its rule, inputs, points, and explanation payload.
6. Re-importing identical data must converge on the same canonical state without duplicates.
7. Flyway owns schema evolution. Never mutate the database schema implicitly at application startup.
8. Application and Kysely schema types must stay synchronized with migrations.
9. Personal workbooks, tokens, secrets, local paths, and unredacted exports must not be committed or exposed in API responses.
10. Dependencies point toward shared/pure packages; UI and framework code must not leak into domain logic.

## Repository map and entry points

### Root workflow

- `package.json` — canonical commands, pinned package manager, workspace-wide validation.
- `pnpm-workspace.yaml` — workspace boundaries under `apps/*` and `packages/*`.
- `.env.example` — local database, Redis, API/web ports, and import directory defaults.
- `docker-compose.yml` — Postgres 16, Redis 7, and Flyway services.
- `.github/workflows/ci.yml` — required install, typecheck, test, and build checks.
- `CONTRIBUTING.md` — package boundaries, importer/scoring/migration rules, and PR expectations.

### API: `apps/api`

Start with:

- `apps/api/src/main.ts` — NestJS bootstrap, CORS, and API port.
- `apps/api/src/app.module.ts` — registered controllers and database provider.
- `apps/api/src/db.provider.ts` — database lifecycle boundary.
- `apps/api/src/imports/imports.controller.ts` — current local-path import HTTP boundary.
- `apps/api/src/daily/daily.controller.ts` — daily summary endpoint; score-breakdown work begins here.
- `apps/api/src/performance/performance.controller.ts` — performance query boundary.

API code should validate and bound user input, orchestrate package services, and return stable contracts. It must not reproduce importer or scoring rules.

### Web: `apps/web`

Start with:

- `apps/web/src/main.ts` — Angular bootstrap and chart providers.
- `apps/web/src/app/app.component.ts` — current review-shell composition.
- `apps/web/src/app/api.service.ts` — HTTP contracts used by components.
- `apps/web/src/app/daily-log.component.ts` — daily summaries and reconciliation entry point.
- `apps/web/src/app/import-panel.component.ts` — current development-only local import controls.
- `apps/web/src/app/run-lab.component.ts` — performance review entry point.

The web app renders canonical data. Do not place authoritative scoring, deduplication, or workbook interpretation in Angular components.

### Worker: `apps/worker`

Start with:

- `apps/worker/src/import-local.ts` — local CLI import entry point.
- `apps/worker/src/dry-run.ts` — parser/import inspection path.
- `apps/worker/package.json` — worker commands.

Keep worker orchestration thin. Import semantics belong in `packages/importers`; future queue/provider execution should call the same package services.

### Import boundary: `packages/importers`

Start with:

- `packages/importers/src/import-service.ts` — current end-to-end local import orchestration and primary idempotency/transaction hotspot.
- `packages/importers/src/xlsx-reader.ts` — workbook extraction, sheet rows, hashes, and raw input boundary.
- `packages/importers/src/my-sport.importer.ts` — daily-ledger interpretation.
- `packages/importers/src/run-db.importer.ts` — running workbook interpretation.
- `packages/importers/src/index.ts` — public package exports.

Every importer change needs a synthetic/anonymized fixture, successful normalization tests, malformed/ambiguous cases, expected warnings, duplicate-safety evidence, and an update to `docs/SPREADSHEET_MAPPING.md` when semantics change.

### Domain logic: `packages/domain`

Start with:

- `packages/domain/src/scoring.ts` — deterministic scoring and ledger creation.
- `packages/domain/src/scoring.test.ts` — current scoring baseline.
- `packages/domain/src/types.ts` — canonical domain contracts.
- `packages/domain/src/daily.ts` — daily aggregation helpers.
- `packages/domain/src/performance.ts` — performance calculations.
- `packages/domain/src/units.ts` — explicit unit conversions.

Keep this package pure: no database, HTTP, Angular, NestJS, filesystem, provider SDK, or generated-text dependencies.

### Persistence: `packages/db`

Start with:

- `packages/db/src/schema.ts` — Kysely table/view types.
- `packages/db/src/pool.ts` — database connection creation.
- `packages/db/src/repositories/imports.repository.ts` — batch/source-record persistence.
- `packages/db/src/repositories/daily.repository.ts` — activities, daily metrics, score ledger, and daily read model.
- `packages/db/src/repositories/scoring.repository.ts` — active rule reads.
- `packages/db/src/repositories/performance.repository.ts` — performance event writes/queries.

Repositories own typed queries, not business interpretation. Add a new ordered Flyway migration for schema changes; never rewrite a migration that may already have run.

### Database migrations: `flyway/sql`

Inspect all existing migrations before adding one. New migrations must be append-only, forward-compatible, explicit about backfills/indexes, and accompanied by synchronized `packages/db/src/schema.ts` changes.

### Shared and analytics

- `packages/shared` — serialization schemas plus low-level date/hash helpers.
- `packages/analytics` — pure analytics that do not require a database.

Prefer shared runtime schemas for API contracts when data crosses process or trust boundaries.

### Documentation

- `docs/ARCHITECTURE.md` — system boundaries, package responsibilities, invariants, and runtime flows.
- `docs/FIRST_MILESTONE.md` — MVP-0 objective and exit criteria.
- `docs/ROADMAP.md` — risk-ordered milestones and status vocabulary.
- `docs/SPREADSHEET_MAPPING.md` — confirmed workbook semantics and unresolved ambiguity.

Update documentation in the same pull request when setup, architecture, workbook mappings, endpoints, milestone status, scoring semantics, or operational assumptions change.

## Common commands

Run from the repository root:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm build
```

Development entry points:

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:worker
```

Local workbook import:

```bash
pnpm import:local -- \
  --mySport=/absolute/path/to/my_sport.xlsx \
  --runDb=/absolute/path/to/running-performance.xlsx
```

Database lifecycle:

```bash
pnpm db:info
pnpm db:down
```

Use pnpm exclusively. Do not create or commit npm/Yarn lockfiles, framework caches, build output, local environment files, or personal workbook data.

## Investigation protocol

Before editing:

1. read the issue, its dependencies, and linked pull requests;
2. inspect the closest entry points listed above;
3. inspect existing tests and migrations for the affected behavior;
4. identify which architecture invariant and roadmap exit criterion the change advances;
5. list the files inspected in the issue or pull-request investigation note.

Prefer evidence from current source code over assumptions in stale comments. When documentation and code disagree, call out the mismatch and update the appropriate source of truth.

## Change-specific requirements

### Importer or normalization changes

- Add fixture coverage before changing semantics.
- Persist raw rows before normalization.
- Preserve row and batch traceability.
- Test malformed and unknown structures.
- Verify repeated imports do not duplicate facts.
- Update spreadsheet mapping documentation.

### Scoring changes

- Add domain tests for normal and boundary cases.
- State units, rounding order, thresholds, and effective dates.
- State whether historical recomputation is required.
- Ensure ledger output identifies the applied rule and inputs.
- Provide reconciliation evidence against imported totals when relevant.

### Database changes

- Add an ordered Flyway migration.
- Add indexes/constraints for new access paths or invariants.
- Keep Kysely types synchronized.
- Document backfill, recovery, and data-integrity impact.
- Run migration and database-backed tests.

### API changes

- Validate route, query, and body inputs.
- Bound limits and pagination.
- Return actionable errors without leaking filesystem or personal data.
- Define/test response contracts and update README endpoint documentation.

### Web changes

- Treat API responses as the canonical source.
- Cover loading, empty, error, and partial-provenance states.
- Keep primary workflows keyboard accessible.
- Add service/component tests and include visual evidence in the PR.

### Jobs and integrations

- Design for duplicate delivery and retries.
- Preserve owner and provenance context through asynchronous execution.
- Define state transitions, cancellation, stale-job recovery, and rate-limit behavior.
- Store raw provider/source records before normalization.

### AI features

- Expose narrow read-only tools over stable views/contracts.
- Keep calculations deterministic outside the model.
- Require record/date/rule provenance in factual answers.
- Test missing, conflicting, malicious, and insufficient data.
- Never grant generated text authoritative write access.

## Branch, commit, and pull-request rules

- Always branch from current `main`.
- Never commit directly to `main`.
- Do not merge to `main` unless a maintainer explicitly asks.
- When merging is explicitly requested, use a squash merge.
- Keep commits and the PR focused on one primary issue.
- Link the issue and state which milestone exit criterion advances.
- Open a draft PR early for multi-step work.
- Do not silently expand scope; create or link a follow-up issue.

A pull request description should include:

- current problem and intended outcome;
- files and areas inspected;
- implementation summary;
- architecture/milestone impact;
- validation performed and evidence;
- migration, privacy, data-integrity, or recomputation implications;
- known limitations and follow-up issues.

## Definition of done

A queue item is done only when:

- acceptance criteria in the issue are satisfied;
- relevant unit, integration, contract, migration, and UI tests pass;
- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass;
- documentation is updated with the change;
- data-integrity and privacy implications are addressed;
- the implementation PR is merged;
- the linked issue is closed and its checkbox in issue #3 is updated.

If full validation cannot be run, record exactly what was not run and why. Do not represent unverified behavior as validated or operational.