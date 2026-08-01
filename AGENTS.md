# AGENTS.md

This is the operational entry point for coding agents and maintainers working on SportOS.

## Current state

SportOS is an authenticated account-scoped application for importing sports workbooks, preserving source provenance, calculating deterministic scores, and reviewing/exporting canonical results.

Validated capabilities include browser XLSX upload, external source storage, durable import and rule-change jobs, immutable scoring-rule versions, audited recomputation, daily/performance provenance drill-downs, canonical export, OIDC sign-in, opaque server-side sessions, CSRF protection, account-scoped database constraints, forced row-level security, owner-aware workers, and authenticated Angular states.

The next incomplete queue item is #15: provider ingestion framework and the first Strava adapter.

## Start here

1. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/AUTHENTICATION.md`, and relevant ADRs.
2. Open issue #3, the authoritative work queue.
3. Check open pull requests and active claim comments.
4. Select the first ready unchecked issue.
5. Record every file inspected before implementation.

## Queue and branch rules

- Issue #3 is the sole source of truth for order.
- Comment `CLAIMED — branch: issue-<number>-<short-slug>` before work.
- Always create the branch from current `main`; never commit directly to `main`.
- Keep one primary issue per PR and open a draft PR early.
- Do not merge unless explicitly asked; when asked, squash merge.
- If blocked, record the exact blocker and leave the branch safe.

## Non-negotiable invariants

1. External `(issuer, subject)` maps to immutable internal `accounts.id`; mutable email is not ownership identity.
2. Every user-visible row has an explicit owner or documented shared-system exception.
3. Runtime API, worker, and legacy processes use non-owner database roles; schema migration identity is separate.
4. API repository work runs inside `withAccountContext`; account identity comes only from the authenticated session.
5. Forced RLS filters account-owned rows, and valid foreign identifiers return the same generic result as nonexistent identifiers.
6. Same-owner composite foreign keys prevent cross-account provenance, canonical, rule, and job links.
7. Workers may claim globally only through the dedicated trusted role, then must establish the persisted owner for every write.
8. Raw input is retained before normalization with workbook, sheet, row, hash, upload, batch, and owner provenance.
9. Uploaded bytes stay outside Postgres; storage keys and local paths are private.
10. Unknown source semantics are never guessed.
11. Official scoring is deterministic domain logic; generated text never calculates or persists points.
12. Every ledger contribution identifies the exact rule UUID, inputs, points, and explanation payload.
13. Rule UUIDs are immutable versions; enabled ranges are account scoped and non-overlapping.
14. Preview is non-authoritative; rule publication and affected score replacement are atomic.
15. Re-importing identical data converges within one owner without duplicate canonical facts.
16. Flyway owns append-only schema evolution; Kysely types stay synchronized.
17. Postgres is authoritative for jobs and leases; only the current lease owner progresses or completes work.
18. Sessions are opaque server-side records with bounded expiry and revocation; unsafe methods require session-bound CSRF.
19. Private source content, session material, storage internals, paths, formulas, hashes, and owner internals are never committed or exposed.
20. Canonical exports are owner scoped, versioned, bounded, deterministic, count checked, and explicit about provenance.

## Repository entry points

### Root and operations

- `.env.example` — runtime database roles, OIDC, session, worker, and storage settings.
- `docker-compose.yml` and `docker/postgres/init/` — local Postgres and non-owner runtime-role initialization.
- `.github/workflows/ci.yml` — fresh migration and non-owner API/worker/legacy integration gates.
- `docs/AUTHENTICATION.md` — deployment, role, OIDC, session, CSRF, and migration guidance.

### API: `apps/api`

- `src/auth/auth.service.ts` — OIDC flow, identity provisioning, opaque sessions, cookie policy.
- `src/auth/session.guard.ts` — global session and CSRF enforcement.
- `src/auth/auth.controller.ts` — login, callback, session, logout, optional local bootstrap.
- `src/auth/current-account.decorator.ts` — authenticated account extraction.
- `src/db.provider.ts` — database lifecycle and account-scoped transaction execution.
- `src/imports/`, `rules/`, `daily/`, `performance/`, `exports/` — owner-scoped application routes.

Never accept owner or audit-actor identifiers from request bodies. Derive them from the authenticated request and execute database work inside account context.

### Web: `apps/web`

- `src/app/web-auth.service.ts` — session bootstrap, sign-in, expiry, and sign-out.
- `src/app/auth-http.interceptor.ts` — credentialed requests, CSRF, and global unauthorized handling.
- `src/app/app.component.ts` — protected cockpit composition after session success.
- remaining components render API truth only and never assign ownership or calculate official scores.

### Worker: `apps/worker`

- `src/import-worker.ts` — dedicated worker database connection and shutdown.
- `src/import-job-runner.ts` — global claim followed by claimed-owner import execution.
- `src/rule-change-runner.ts` — global claim followed by claimed-owner atomic recomputation.
- `src/import-local.ts` — fixed legacy-owner local CLI.

The broad worker policy is a trusted-system exception and must not be reused by API or browser code.

### Persistence: `packages/db`

- `src/schema.ts` — account/session/owned table and view types.
- `src/ownership-context.ts` — `withAccountContext` and fixed legacy owner.
- `src/repositories/auth.repository.ts` — identity, authorization transaction, and session persistence.
- queue, import, rule, daily, performance, and export repositories remain typed query/transaction boundaries.

### Domain/shared/importers

- `packages/domain` — pure authoritative scoring, reconciliation, rule validation, and preview.
- `packages/shared` — serialization, date, and export contracts.
- `packages/importers` — storage, XLSX extraction, normalization, warnings, and import transactions.
- authentication/framework dependencies do not belong in pure packages.

### Migrations and decisions

- inspect all `flyway/sql/` migrations before adding the next append-only version;
- V105.1 provides upgrade-safe runtime-role placeholders;
- V106 adds accounts, sessions, owners, RLS, and same-owner constraints;
- V107 keeps owner internals out of the public performance view;
- ADRs 0001–0005 document import, storage, jobs, rule publication, and authentication/ownership.

## Change requirements

### Authentication and ownership

- keep runtime connections separate from the schema owner;
- use exact configured origins and protected cookies in production;
- store only session/token digests and sanitize errors/logs;
- require CSRF on unsafe authenticated methods;
- derive account and audit actor from the session;
- add same-user positive and cross-user negative tests for identifiers, jobs, exports, rules, and workers;
- document existing-volume migration and secret rotation.

### Imports, jobs, and providers

- validate and bound all external input;
- retain raw source before normalization and preserve owner/provenance links;
- prove retries and duplicate delivery converge within one owner;
- keep provider authorization material server-side and provider cursors owner scoped;
- never expose object keys, paths, provider authorization data, or foreign account details.

### Scoring, cockpit, and export

- keep calculations in `packages/domain`;
- preserve immutable historical UUIDs and account-scoped effective ranges;
- preview without writes and publish recomputation atomically;
- validate dates, ranges, numbers, pagination, and UUIDs before querying;
- exclude owner fields and private/raw/storage data from exports;
- cover authenticated loading, anonymous, error, expiry, and sign-out states plus workflow states.

### Database

- use append-only Flyway migrations and synchronize Kysely types;
- add constraints, indexes, and RLS for new invariants;
- test fresh migration and populated upgrade/backfill paths when applicable;
- run integration using the intended non-owner runtime role.

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

Use pnpm only. Do not commit build output, caches, local environment files, uploaded files, authorization material, or personal data.

## Investigation protocol and definition of done

Before editing, read the issue/dependencies/PRs, inspect the closest code/tests/migrations, identify the invariant and roadmap exit criterion, list all inspected files, and call out documentation mismatches.

A queue item is complete only when acceptance criteria are satisfied; relevant domain, API, UI, migration, database, worker, and importer tests and root validation pass; documentation and privacy/integrity implications are current; the PR is merged; the issue is closed; and issue #3 is updated. Incomplete validation must be stated explicitly.
