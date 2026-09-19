# AGENTS.md

This is the operational entry point for coding agents and maintainers working on SportOS.

## Current state

SportOS is an authenticated account-scoped application for importing sports workbooks, synchronizing Strava activity, preserving raw source provenance, calculating deterministic scores, reviewing/exporting canonical results, and producing cited read-only generated analysis.

Validated capabilities include browser XLSX and manual Garmin CSV upload, external source storage, encrypted provider credentials, Strava connection/backfill/incremental sync, durable import/provider/rule jobs, immutable scoring-rule versions, audited recomputation, daily/performance provenance drill-downs, canonical export, narrow deterministic analysis tools, citation-validated generation with safe fallback, append-only analysis audit metadata, OIDC sign-in, opaque server-side sessions, CSRF protection, account-scoped database constraints, forced row-level security, split worker authorization, authenticated Angular routes, canonical Monthly Stats, and calendar-day rolling metric Dynamics.

The foundational queue in issue #3 is complete through #16. Later product work and the P4 frontend-architecture lane are prioritized there, and those lanes may proceed in parallel when they do not substantially modify the same feature or infrastructure. Do not invent the next item; select only the first unchecked ready item or work explicitly reprioritized by a maintainer.

## Start here

1. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/AUTHENTICATION.md`, `docs/AI_ANALYSIS.md`, and relevant ADRs. For Angular work, also read `docs/FRONTEND_ARCHITECTURE.md`.
2. Open issue #3, the authoritative work queue.
3. Check open pull requests and active claim comments.
4. Select the first ready unchecked issue, if one exists.
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
3. Runtime API, dispatcher, worker-data, and legacy processes use non-owner database roles; schema migration identity is separate.
4. API and worker-data repository work runs inside `withAccountContext`; account identity comes only from the authenticated session or persisted claim.
5. `withAccountContext` reserves one pooled connection, sets the account for that connection, supports repository-owned transactions, and clears the setting before release.
6. Forced RLS filters account-owned rows, and valid foreign identifiers return the same generic result as nonexistent identifiers.
7. Same-owner composite foreign keys and immutable-owner triggers prevent cross-account links or reassignment.
8. Queue discovery uses the narrow dispatcher role; provider credentials, source, canonical, rule, ledger, performance, and authentication data use the owner-scoped worker-data role.
9. Raw input is retained before normalization with source, record key, hash, batch, owner, and source-specific provenance.
10. Uploaded bytes stay outside Postgres; storage keys and local paths are private.
11. Provider access and refresh tokens remain server-side inside authenticated encrypted envelopes; never expose them to the browser, dispatcher, logs, errors, or exports.
12. Provider credential envelopes use AES-256-GCM, versioned key IDs, random nonces, and additional authenticated data binding owner, connection, provider, and version.
13. Provider-native identity is primary within a connection; cross-source matching follows the documented exact/no-match/ambiguous policy and never guesses.
14. Unsupported or ambiguous provider records remain inspectable raw source records with warnings.
15. Unknown source semantics are never guessed.
16. Official scoring is deterministic domain logic; generated text and provider payloads never calculate or persist official points directly.
17. Every ledger contribution identifies the exact rule UUID, inputs, points, and explanation payload.
18. Rule UUIDs are immutable versions; enabled ranges are account scoped and non-overlapping.
19. Preview is non-authoritative; rule publication and affected score replacement are atomic.
20. Re-importing or redelivering identical source data converges within one owner without duplicate canonical facts.
21. Flyway owns append-only schema evolution; Kysely types stay synchronized.
22. Postgres is authoritative for jobs and leases; only the current lease owner progresses or completes work.
23. Rate-limit rescheduling is durable and does not consume the provider job retry budget.
24. Sessions are opaque server-side records with bounded expiry and revocation; unsafe methods require session-bound CSRF.
25. Private source content, provider payloads, credential envelopes, session material, storage internals, paths, formulas, hashes, authentication data, owner internals, raw analysis questions, and generated answers are never committed or unnecessarily persisted/exposed.
26. Canonical exports are owner scoped, versioned, bounded, deterministic, count checked, and explicit about provenance.
27. Analysis accepts only fixed, bounded read tools; browsers and models never select owners, repositories, SQL, or arbitrary filters.
28. Analysis totals, trends, comparisons, and official score explanations are deterministic application output.
29. Generated observations cite only evidence identifiers returned by the executed tool; invalid external output falls back safely.
30. Imported/user-authored narrative and private source metadata are excluded before generation and never treated as instructions.
31. Analysis audit rows are owner scoped and append-only for the API role, and store only hashes, bounded input metadata, citation identifiers, generator metadata, outcome, and quality status.
32. Generated observations, uncertainty, suggestions, and official records remain structurally and visibly distinct.

## Repository entry points

### Root and operations

- `.env.example` — API, dispatcher, worker-data, legacy, OIDC, session, provider, encryption-key, optional AI-generator, and storage settings.
- `scripts/flyway.mjs` — Neon schema-owner migration configuration and Flyway CLI bridge.
- `.github/workflows/ci.yml` — fresh/populated migration and non-owner API/analysis/dispatcher/worker-data/legacy integration gates.
- `docs/AUTHENTICATION.md` — deployment, role, OIDC, session, CSRF, legacy claim, and migration guidance.
- `docs/AI_ANALYSIS.md` — read-only analysis API, generator contract, privacy boundary, audit, and operations.
- `docs/adr/0006-provider-ingestion-and-strava.md` — provider authorization, encryption, sync, provenance, and identity policy.
- `docs/adr/0007-read-only-ai-analysis.md` — analysis tools, deterministic calculations, generation validation, audit, and UI decision.

### API: `apps/api`

- `src/auth/` — OIDC flow, identity provisioning, legacy claim, opaque sessions, cookie and CSRF policy.
- `src/providers/providers.service.ts` — Strava OAuth exchange, encrypted credential persistence, sync orchestration, revoke/disconnect.
- `src/providers/providers.controller.ts` — account-scoped provider connection and sync routes.
- `src/analysis/analysis-tool.service.ts` — fixed account-scoped read tools, deterministic calculations, citations, and data-quality flags.
- `src/analysis/analysis.model.ts` — provider-neutral external JSON generator contract, strict validation, and deterministic fallback.
- `src/analysis/analysis.service.ts` — answer orchestration, write refusal, health limitations, and redacted audit recording.
- `src/db.provider.ts` — database lifecycle and account-bound execution.
- `src/imports/`, `rules/`, `daily/`, `performance/`, `exports/` — owner-scoped application routes.
- `src/activities/` — filtered canonical activity list and detail routes, independent of daily scoring and performance events.

Never accept owner or audit-actor identifiers from request bodies. Derive them from the authenticated request and execute database work inside account context. Provider callbacks require the initiating authenticated account and one-time state. Analysis questions never grant write authority or broaden the tool allowlist.

### Web: `apps/web`

- `docs/FRONTEND_ARCHITECTURE.md` — target `core/`, `shared/`, and feature-slice boundaries, dependency direction, migration rules, and focused validation policy.
- `src/app/app.component.ts` — authenticated application shell only.
- `src/app/app.routes.ts` — lazy route entry points.
- `src/app/app.config.ts` — application bootstrap providers; keep `main.ts` minimal.
- `src/app/core/config/api-base.ts` — the single `SPORTOS_API_BASE` token and local-development default. Every SportOS HTTP client injects this token directly rather than depending on another service for the API URL.
- `src/app/core/http/` — authentication/CSRF HTTP infrastructure. Credential attachment and API-origin checks must use the same configured API base.
- `src/app` is currently a transitional flat layout. New substantial feature code belongs under `src/app/features/<feature>/`; application-wide infrastructure belongs under `src/app/core/`; reusable feature-agnostic UI/utilities belong under `src/app/shared/`.
- Existing `api.service.ts`, feature orchestration, route components, and presenters migrate incrementally through issues #75-#80. Root HTTP/origin re-exports are compatibility shims only; new infrastructure imports should target `core/`. Do not perform unrelated mass moves.
- `src/app/features/daily/state/daily-log.store.ts` — reference route-scoped signal facade for multi-request Daily workflows, cancellation/stale-response protection, and bounded Strava job polling through `core/jobs/durable-job-poller.ts`. Keep route navigation in the page and workflow tests beside the store.
- `src/app/features/daily/model/daily-quick-entry.models.ts` — feature-owned quick-entry contracts and pure row transformations used by Daily state and UI. State must not import Angular components.
- Daily still consumes transitional root API services until #77 moves feature transport contracts into `features/daily/data-access/`; do not add new global API methods as part of unrelated Daily work.
- `src/app/features/activities/` — canonical Activities API client, metric view model, list presenter, and list/detail route pages.

Angular renders API truth only. It never receives provider tokens/envelopes, assigns ownership, normalizes canonical facts, calculates official scores, or treats generated guidance as authoritative.

### Worker: `apps/worker`

- `src/import-worker.ts` — requires separate dispatcher and worker-data connections; provider runner starts only when all provider/key settings are present.
- `src/import-job-runner.ts` — global claim followed by owner-scoped workbook import.
- `src/provider-sync-runner.ts` — global claim followed by owner-scoped credential refresh, pagination, raw retention, conservative normalization, cursor commit, and terminal state.
- `src/rule-change-runner.ts` — global claim followed by owner-scoped atomic recomputation.
- `src/import-local.ts` — fixed legacy-owner local CLI.

The dispatcher is a narrow trusted-system exception. It may inspect queue lifecycle and upload dispatch metadata only. Never reuse dispatcher credentials for API, provider decryption, analysis, browser, local CLI, or canonical-data work.

### Persistence: `packages/db`

- `src/schema.ts` — account/session/provider/owned table and view types.
- `src/analysis-schema.ts` — append-only analysis audit table types.
- `src/ownership-context.ts` — account-bound pooled connection and fixed legacy owner.
- `src/repositories/auth.repository.ts` — identity, legacy claim, authorization transaction, and session persistence.
- `src/repositories/providers.repository.ts` — provider OAuth state, connections, encrypted credentials, sync jobs, raw/canonical links, and cross-source identity.
- `src/repositories/analysis-audit.repository.ts` — bounded owner-scoped analysis audit inserts and reads.
- `src/repositories/worker-dispatch.repository.ts` — narrow cross-owner import/provider/rule claim and stale recovery.
- remaining queue, import, rule, daily, performance, and export repositories remain typed query/transaction boundaries.
- `src/repositories/activities.repository.ts` — selected canonical activity reads, filtered summary, and bounded paging under account context.

Canonical Activities represent training history from `activities`. Daily Log and its ledger represent day-level scoring; performance events and Run Lab represent separate running achievement data. Keep those reads and presentations independent. The advanced source JSON disclosure reads only the linked, owner-scoped source record on demand; raw provider fields are not canonical metrics. See `docs/ACTIVITIES.md` for the API and MVP limits.

### Domain/shared/importers

- `packages/domain` — pure authoritative scoring, reconciliation, rule validation, and preview.
- `packages/shared` — serialization, date, and export contracts.
- `packages/importers` — storage, XLSX/Garmin CSV extraction, provider adapter/cipher contracts, normalization, warnings, and import transactions.
- `packages/analytics` — pure analytics without database dependencies.
- authentication/framework/model-provider dependencies do not belong in pure packages.

### Migrations and decisions

- inspect all `flyway/sql/` migrations before adding the next append-only version;
- V105.1 provides upgrade-safe runtime-role placeholders;
- V106 adds accounts, sessions, owners, RLS, and same-owner constraints;
- V107 keeps owner internals out of the public performance view;
- V108 splits dispatcher/worker-data authorization, restricts authentication tables, and makes ownership immutable;
- V109 adds provider connections, encrypted credentials, OAuth state, sync jobs, links, webhook inbox, RLS, direct grants, and privilege assertions;
- V110 adds append-only owner-scoped analysis audit metadata with app-only grants and privilege assertions;
- V115 adds grouped universal run-pace tiers, completed-5km point multipliers, atomic non-imported score recomputation, and retained legacy run-rule history;
- V116 versions the run-pace tiers with favourable 0.1 km and 0.1 min/km eligibility rounding while preserving strict V115 rule UUID history and atomically recomputing non-imported scores;
- V117 versions the bike achievement with a bounded 0.1 km/h tolerance around the 20 km/h target, preserves strict V114 UUID history, and atomically recomputes calculated scores;
- V118 unifies bonus authority, reclassifies imported manual bonuses without changing totals, migrates canonical bonus activities and current snapshot facts, versions the manual bonus rule, and removes `daily_metrics.power_points`;
- V119 adds manual Garmin CSV uploads, raw-row provenance, and overlap-safe account-scoped staging without canonical or scoring side effects;
- ADRs 0001–0007 document import, storage, jobs, rule publication, authentication/ownership, providers, and read-only analysis.

## Change requirements

### Authentication, ownership, and providers

- keep all runtime connections separate from the schema owner;
- use exact configured origins and protected cookies in production;
- store only session/token digests or authenticated provider ciphertext; sanitize errors/logs;
- require CSRF on unsafe authenticated methods;
- derive account and audit actor from the session;
- preserve the configured one-time legacy OIDC claim path;
- keep provider OAuth state one-time, hashed, owner scoped, and expiring;
- rotate refresh tokens atomically and retain old encryption keys until envelopes have migrated;
- add same-user positive and cross-user negative tests for identifiers, jobs, exports, rules, providers, analysis, and workers;
- prove the dispatcher cannot read provider connections/credentials, analysis audits, canonical, rule, ledger, source, performance, or authentication data.

### Imports, jobs, and providers

- validate and bound all external input and provider payload retention;
- retain raw source before normalization and preserve owner/provenance links;
- prove retries and duplicate delivery converge within one owner;
- keep provider authorization material server-side and provider cursors owner scoped;
- persist cursor/count state only after the corresponding page commits;
- preserve workbook/manual facts when provider identity links to them;
- surface ambiguous cross-source collisions rather than merging them;
- never expose object keys, paths, provider authorization data, raw payloads, or foreign account details.

### Analysis

- reuse stable account-scoped repositories; never add model SQL or direct canonical-table access;
- keep all calculations deterministic and outside generated text;
- require exact returned citation identifiers for generated observations;
- reject unsupported fields, unknown citations, oversized output, ambiguous ranges, and authoritative write requests;
- exclude notes, filenames, sheet/row metadata, source/upload hashes, rule narrative, credentials, auth data, and owner internals from generation;
- store only bounded append-only audit metadata, never raw questions or generated answers;
- add evaluation cases for missing/conflicting/malicious/insufficient data and unsupported conclusions;
- keep external generation optional, server-side, HTTPS-bound, timeout-bounded, and safely fallible;
- make generated guidance and official evidence visibly distinct in Angular.

### Scoring, cockpit, and export

- keep calculations in `packages/domain` or other deterministic application code;
- preserve immutable historical UUIDs and account-scoped effective ranges;
- preview without writes and publish recomputation atomically;
- validate dates, ranges, numbers, pagination, UUIDs, and analysis question/tool contracts before querying;
- exclude owner fields and private/raw/storage/authentication/provider credential/analysis prompt data from exports;
- cover authenticated loading, anonymous, error, expiry, sign-out, provider, analysis, and workflow states;
- bound browser polling and provide a manual refresh path.

### Database

- use append-only Flyway migrations and synchronize Kysely types;
- add constraints, indexes, RLS, grants, immutable-owner enforcement, append-only enforcement, and privilege assertions for new invariants;
- test fresh migration and populated upgrade paths when applicable;
- run integration using the intended non-owner runtime roles.

### Angular architecture and focused validation

- Follow `docs/FRONTEND_ARCHITECTURE.md` for all substantial web work.
- Target dependency direction is page -> feature state -> feature data-access, with feature code using feature models and reusable `shared/` code.
- `shared/` and `core/` must not depend on features; data-access must not depend on UI; state must not import components; presentational components must not inject `HttpClient`.
- Prefer feature-scoped injectable signal facades/stores for multi-request orchestration, cancellation/stale-response protection, durable jobs, retries, and shared workflow state. Do not introduce NgRx.
- Authentication, HTTP-wide behavior, API configuration, and generic durable-job infrastructure belong under `core/`; use `core/jobs/durable-job-poller.ts` for bounded durable-job status checks and cancel by unsubscribing on teardown/replacement. Do not add feature-local polling timers; feature transport contracts belong with feature data access.
- For frontend-only work, run the smallest relevant Vitest files and `pnpm --filter @sportos/web typecheck`. Run `pnpm --filter @sportos/web build` when templates, lazy routes, providers, or bundling integration changed.
- Do not routinely run migrations, backend/database integrations, worker/importer suites, or the full repository matrix for frontend-only refactors. Broaden validation only when the change crosses runtime/package boundaries or targeted evidence is insufficient.

## Common commands

```bash
pnpm install --frozen-lockfile
cp .env.example .env
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

Use pnpm only. Do not commit build output, caches, local environment files, uploaded files, authorization material, encryption/API keys, provider payloads, raw prompts, generated personal content, or personal data.

## Investigation protocol and definition of done

Before editing, read the issue/dependencies/PRs, inspect the closest code/tests/migrations, identify the invariant and roadmap exit criterion, list all inspected files, and call out documentation mismatches.

A queue item is complete only when acceptance criteria are satisfied; relevant domain, API, UI, migration, database, worker, importer/provider, analysis evaluation, and root validation pass; documentation and privacy/integrity implications are current; the PR is merged; the issue is closed; and issue #3 is updated. Incomplete validation must be stated explicitly.
