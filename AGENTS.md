# AGENTS.md

This is the operational entry point for coding agents and maintainers working on SportOS.

## Current state

SportOS is an authenticated account-scoped application for importing sports workbooks, synchronizing Strava activity, preserving raw source provenance, calculating deterministic scores, reviewing/exporting canonical results, and producing cited read-only generated analysis.

Validated capabilities include browser XLSX upload, external source storage, encrypted provider credentials, Strava connection/backfill/incremental sync, durable import/provider/rule jobs, immutable scoring-rule versions, audited recomputation, daily/performance provenance drill-downs, canonical export, narrow deterministic analysis tools, citation-validated generation with safe fallback, append-only analysis audit metadata, OIDC sign-in, opaque server-side sessions, CSRF protection, account-scoped database constraints, forced row-level security, split worker authorization, and authenticated Angular states.

The ordered queue in issue #3 is complete through #16. Do not invent the next product item; select work only after issue #3 contains a new unchecked ready item or a maintainer explicitly reprioritizes the queue.

## Start here

1. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/AUTHENTICATION.md`, `docs/AI_ANALYSIS.md`, and relevant ADRs.
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

Never accept owner or audit-actor identifiers from request bodies. Derive them from the authenticated request and execute database work inside account context. Provider callbacks require the initiating authenticated account and one-time state. Analysis questions never grant write authority or broaden the tool allowlist.

### Web: `apps/web`

- `src/app/web-auth.service.ts` — session bootstrap, sign-in, expiry, and sign-out.
- `src/app/auth-http.interceptor.ts` — exact-API-origin credentials, CSRF, and global unauthorized handling.
- `src/app/provider-panel.component.ts` — connection, backfill/sync, progress, retry, cancel, disconnect, provenance, bounded polling.
- `src/app/provider-api.service.ts` — user-safe provider API contracts only.
- `src/app/analysis-panel.component.ts` — bounded questions, explicit read-only limitation, generated guidance, official evidence, citations, quality flags, and audit reference.
- `src/app/analysis-api.service.ts` — user-safe analysis contracts only.
- `src/app/app.component.ts` — protected cockpit composition after session success.

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

### Domain/shared/importers

- `packages/domain` — pure authoritative scoring, reconciliation, rule validation, and preview.
- `packages/shared` — serialization, date, and export contracts.
- `packages/importers` — storage, XLSX extraction, provider adapter/cipher contracts, normalization, warnings, and import transactions.
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
