# Architecture

## Goal

Replace spreadsheet formulas with a canonical, auditable sports-data system while preserving source provenance, deterministic score explanations, and account ownership.

```text
OIDC provider
      |
      v
opaque API session + CSRF
      |
      v
account-bound pooled connection -> forced RLS + same-owner constraints
      |
browser XLSX / local CLI / future providers
      |
      v
upload storage + uploaded_files
      |
      v
import_jobs / scoring_rule_changes
      |
      v
narrow queue dispatcher (cross-owner lifecycle only)
      |
      +---- persisted immutable owner ----+
                                          |
                                          v
                         owner-scoped worker-data executor
                                          |
                                          v
                    import_batches + source_records
                                          |
                                          v
       activities + daily_metrics + performance_events
                                          |
                                          v
         scoring_rules + score_ledger + audited changes
                                          |
                                          v
             owner-scoped reads + canonical export
                                          |
                                          v
                         NestJS API -> Angular cockpit
```

## System boundary

SportOS is an authenticated account-scoped monorepo. Postgres is authoritative for accounts, external identities, sessions, ownership, job leases, audit history, provenance, canonical facts, rule versions, and official scores. Workbook bytes remain outside Postgres behind a replaceable storage contract.

The API authenticates an opaque server-side session, validates CSRF for unsafe methods, reserves one pooled connection, establishes the authenticated account on that connection, runs repository-owned transactions, and clears the context before release. Angular renders API truth only.

Background processing uses two database identities. A narrow dispatcher may discover and lease jobs across accounts but cannot read source, canonical, scoring, ledger, performance, or authentication data. A separate worker-data identity executes the claimed job under the persisted owner.

## Architectural invariants

1. External `(issuer, subject)` maps to one immutable internal account UUID; mutable profile attributes are not ownership identity.
2. Every user-visible record has an explicit owner or documented shared-system exception.
3. Runtime identities are non-superuser and separate from the Flyway/schema owner.
4. API and worker-data access is account scoped by forced PostgreSQL RLS.
5. Account context is set on one reserved pooled connection and reset before release.
6. Valid foreign identifiers are indistinguishable from nonexistent identifiers at the API boundary.
7. Same-owner composite foreign keys prevent cross-account provenance, canonical, rule, and job links.
8. Owner columns are immutable after insertion.
9. Queue dispatch is separated from owner-scoped data execution.
10. Raw input is retained before normalization with workbook, sheet, row, hash, upload, batch, and owner provenance.
11. Uploaded bytes stay outside Postgres; storage keys, roots, and paths are private.
12. Official scoring is deterministic domain output and does not depend on Angular or generated text.
13. Every score contribution identifies the exact rule UUID, inputs, reason, and calculation payload.
14. Rule UUIDs are immutable semantic versions; enabled effective ranges are account scoped and cannot overlap.
15. Preview is read-only; rule publication and affected score replacement are atomic.
16. Re-imports converge within an owner without duplicate canonical facts.
17. Postgres is authoritative for job state and leases; only the current lease owner may progress or complete work.
18. Sessions are opaque, digest-backed, bounded by idle/absolute expiry, revocable, and protected by session-bound CSRF.
19. Public dates are real `YYYY-MM-DD` calendar values normalized at repository boundaries.
20. Canonical exports are owner scoped, versioned, range bounded, deterministic, count checked, and assembled from one repeatable-read snapshot.
21. Raw cells, formulas, raw payloads, upload hashes, storage internals, account IDs, authentication data, and source bytes are excluded from canonical export.

## Identity, sessions, and authorization

Authentication control-plane tables:

- `accounts`
- `external_identities`
- `auth_sessions`
- `auth_transactions`

SportOS uses OIDC Authorization Code with PKCE and does not store passwords. The provider's immutable issuer/subject pair provisions an internal account. Only opaque session and CSRF digests are stored. Sign-out revokes the server-side session.

The migrated single-user data belongs to fixed legacy account `00000000-0000-4000-8000-000000000001`. One explicitly configured OIDC issuer/subject may claim that account atomically; a second identity cannot claim it.

Runtime database identities:

- `sportos_app` — authentication control plane and account-scoped API data;
- `sportos_legacy` — fixed legacy-account local CLI and compatibility tests;
- `sportos_worker` — narrow cross-owner queue dispatcher;
- `sportos_worker_data` — account-scoped import/recomputation execution;
- `sportos_data` — shared no-login privileges, excluding authentication tables.

Credentialed CORS accepts one configured web origin. Unsafe authenticated requests require the readable CSRF cookie to be echoed in `X-SportOS-CSRF` and matched to the active session digest.

See [ADR 0005](adr/0005-authentication-and-data-ownership.md) and [AUTHENTICATION.md](AUTHENTICATION.md).

## Ownership migration

- V105.1 creates upgrade-safe runtime-role placeholders.
- V106 creates identity/session tables, creates and backfills the legacy account, adds non-null owners, converts global identities to account scope, replaces links with same-owner foreign keys, enables forced RLS, and recreates owner-aware views.
- V107 removes owner/private identity fields from the public performance view.
- V108 separates dispatcher and worker-data authorization, restricts authentication-table grants, removes broad future grants, and makes ownership immutable.

Existing upload, batch, source-record, canonical, performance, rule, audit, daily, and ledger UUIDs are preserved during backfill.

## Data and job layers

### Upload storage and metadata

`uploaded_files` stores account-owned metadata only. The `UploadStorage` contract lives in `packages/importers`; local objects use opaque keys and mode-`0600` writes. Public contracts omit object keys, roots, paths, bytes, hashes, and owner internals.

### Import jobs

`import_jobs` persists owner/upload/batch links, phase, progress, attempts, lease state, cancellation, result, and sanitized errors.

The dispatcher claims a job with `FOR UPDATE SKIP LOCKED` and returns the persisted owner. The worker-data executor establishes that owner before reading/writing account data. The transactional importer uses one account-bound connection; progress/cancellation callbacks use separate short owner-scoped connections so they do not deadlock the importer transaction.

### Rule versions and recomputation

A rule family is `(owner_id, code)` and a version is `(owner_id, code, version)`. A GiST exclusion constraint prevents overlapping enabled inclusive ranges within an account.

Activation records the authenticated account as actor. The dispatcher claims the audit job; the worker-data executor establishes the owner and atomically closes the superseded range, enables the proposed UUID, recomputes affected totals, replaces ledger rows, and completes the audit.

### Provenance and canonical facts

Account-owned tables:

- `import_batches`
- `source_records`
- `activities`
- `daily_metrics`
- `performance_events`
- `scoring_rules`
- `scoring_rule_changes`
- `score_ledger`

Dates and deterministic source identities are unique within an account. Composite foreign keys require linked records to share the same owner.

### Read models and export

Invoker-security views operate over RLS-filtered tables and partition window functions by owner before omitting owner fields from public shapes.

Repositories provide narrow boundaries for daily score explanations, bounded cockpit summaries, performance/provenance reads, rule workflows, import diagnostics, and strict canonical export.

## Runtime flows

### Sign-in

1. Browser requests `/auth/login` with a safe local return path.
2. API stores one-time hashed state and PKCE verifier, then redirects to OIDC.
3. Callback exchanges the code, fetches `userinfo`, and provisions or resolves the account.
4. API creates opaque session and CSRF tokens and stores only digests.
5. Angular loads `/auth/session`; protected components are created only after authentication succeeds.
6. Sign-out revokes the server-side session and expires cookies.

### Authenticated API request

1. Global guard authenticates the session.
2. Unsafe methods validate session-bound CSRF.
3. Controller derives the account from the session, never request input.
4. Service reserves an account-bound connection.
5. RLS and same-owner constraints filter and validate repository work.
6. The account setting is cleared before connection release.

### Import worker

1. API validates/stores the upload and enqueues an owner-scoped job.
2. Dispatcher claims globally and returns the persisted owner.
3. Worker-data executor establishes that owner.
4. Importer writes raw rows, canonical facts, scores, and provenance transactionally.
5. Progress and cancellation use short separate owner-scoped connections.
6. Terminal job/upload state remains under the same owner.

### Rule worker

1. Authenticated preview reads only the account's facts and rules.
2. Activation records the authenticated account and enqueues an owner-scoped audit job.
3. Dispatcher claims globally and returns the owner.
4. Worker-data executor recomputes and publishes atomically within that owner.

### Cockpit and export

1. Validate dates, ranges, limits, numbers, and UUIDs before querying.
2. Execute repositories under authenticated account context.
3. Return explicit provenance without storage, owner, or authentication internals.
4. Build canonical export from one owner-scoped repeatable-read snapshot and validate the strict schema.

## Package responsibilities

| Package or app | Responsibility |
|---|---|
| `apps/api` | OIDC/session/CSRF, account context, HTTP validation, orchestration, reads, export delivery |
| `apps/web` | authenticated accessible cockpit; no authoritative calculations |
| `apps/worker` | split queue dispatch and owner-scoped import/rule execution; legacy CLI |
| `packages/shared` | serialization schemas, real-date utilities, canonical export contract |
| `packages/domain` | pure aggregation, scoring, reconciliation, rule validation, preview logic |
| `packages/db` | identity/session persistence, account context, typed schema, RLS-compatible repositories, dispatcher, leases, audits, reads, export assembly |
| `packages/importers` | storage, XLSX extraction, normalization, warnings, import transactions |
| `packages/analytics` | pure analytics without database dependencies |
| `flyway/sql` | append-only migrations, grants, ownership constraints, RLS, views, indexes |

## Current risks

- Workbook assumptions are based on a small known sample.
- Local source storage is single-host and needs coordinated database/object backup.
- Production OIDC, runtime-role provisioning, monitoring, backup/restoration, and account deletion require deployment operations beyond source code.
- The dispatcher is trusted for queue lifecycle and upload dispatch metadata; its credentials require strict isolation.
- Postgres polling adds periodic load; wake-up acceleration must preserve durable claims.
- Rule recomputation and canonical export remain intentionally bounded.
- Provider credential encryption, cursors, cross-source deduplication, and time-zone policy remain issue #15 work.

Milestone sequencing is tracked in [ROADMAP.md](ROADMAP.md).
