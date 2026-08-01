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
account-scoped transaction -> forced RLS + same-owner constraints
      |
browser XLSX / local CLI / future provider integrations
      |
      v
upload storage + uploaded_files
      |
      v
import_jobs ------------------+
      |                        |
      v                        |
independent worker <--- scoring_rule_changes
(global claim, owner context)  |
      |                        |
      v                        |
import_batches + source_records|
      |                        |
      v                        |
activities + daily_metrics + performance_events
      |                        |
      v                        |
scoring_rules + score_ledger <-+
      |
      v
stable owner-scoped reads + canonical export
      |
      v
NestJS API -> Angular cockpit
```

## System boundary

SportOS is an authenticated account-scoped monorepo. Postgres is authoritative for accounts, external identities, sessions, ownership, metadata, job leases, audit history, provenance, canonical facts, rule versions, and official scores. Workbook bytes remain outside Postgres behind a replaceable storage contract.

The API authenticates an opaque server-side session, validates CSRF for unsafe methods, establishes one transaction-local account context, validates bounded read/export inputs, and returns privacy-safe canonical responses. An independent worker uses a separate non-superuser role to claim work globally, then processes each job under its persisted owner context.

## Architectural invariants

1. External `(issuer, subject)` maps to one immutable internal account UUID; mutable email is not ownership identity.
2. Every user-visible record has an explicit owner or documented shared-system exception.
3. API and legacy runtime roles are non-superusers and cannot bypass forced row-level security.
4. A valid foreign identifier is indistinguishable from a nonexistent identifier at the API boundary.
5. Cross-table provenance and canonical links are constrained to the same owner.
6. Background workers preserve the immutable owner from the claimed job/change through every write.
7. Raw input is retained before normalization with workbook, sheet, row, batch, upload, and owner provenance.
8. Canonical facts and official scoring do not depend on Angular or the API process.
9. Official points are deterministic domain output; generated text never calculates or persists them.
10. Every score contribution identifies the exact rule UUID, inputs, reason, and calculation payload.
11. Unknown source semantics are never guessed.
12. Flyway owns append-only schema evolution.
13. Re-imports converge on the same owner-scoped canonical facts without duplicates.
14. Uploaded bytes stay outside Postgres; storage keys and local paths are private.
15. Postgres is authoritative for job state and worker leases.
16. Only the current lease owner may progress or complete running work.
17. Cancellation occurs only at safe transactional boundaries.
18. A rule UUID is one immutable semantic version; account-scoped family ranges cannot overlap.
19. Preview is non-authoritative and cannot mutate rule rows, daily totals, or ledger entries.
20. Rule activation and affected score replacement publish atomically or not at all.
21. Public dates are real `YYYY-MM-DD` calendar values normalized at repository boundaries.
22. Canonical exports are owner scoped, versioned, range bounded, deterministically ordered, count checked, and validated after database assembly.
23. Missing provenance is explicit; source/batch identifiers are never invented.
24. Raw cells, formulas, raw payload JSON, upload hashes, object keys, paths, source bytes, and owner internals are excluded from canonical export.
25. One canonical export is assembled from one repeatable-read database snapshot.

## Identity, sessions, and database authorization

Tables:

- `accounts`
- `external_identities`
- `auth_sessions`
- `auth_transactions`

SportOS uses OIDC Authorization Code with PKCE and does not store passwords. The provider's immutable issuer/subject pair provisions an internal account. Random session and CSRF tokens are returned as cookies; only digests are stored. Sessions have idle and absolute expiry and can be revoked by sign-out.

Credentialed CORS accepts one configured web origin. Unsafe authenticated requests require the readable CSRF cookie to be echoed in `X-SportOS-CSRF`, and the API verifies the token digest against the active server-side session.

Flyway runs as the schema owner. Runtime roles are deliberately non-superuser:

- `sportos_app` for API/session work;
- `sportos_worker` for trusted queue processing;
- `sportos_legacy` for the explicit legacy account/local CLI;
- `sportos_data` as a shared no-login privilege role.

An API operation uses `set_config('sportos.account_id', account_uuid, true)` inside a transaction. Forced RLS policies permit only rows whose `owner_id` matches that setting. Without context, the API role sees no account-owned rows.

Migration V106 backfills existing data to one fixed legacy account without changing existing UUIDs, changes globally unique business identities to account scope, and replaces links with same-owner composite foreign keys. See [ADR 0005](adr/0005-authentication-and-data-ownership.md) and [AUTHENTICATION.md](AUTHENTICATION.md).

## Data and job layers

### Upload storage and metadata

Table: `uploaded_files`

The shared `UploadStorage` contract and local adapter live in `packages/importers`. Local objects use opaque keys and mode-`0600` writes beneath `SPORTOS_UPLOAD_DIR`. Public contracts omit object keys, roots, paths, raw bytes, and owner internals. Duplicate lookup is owner scoped. See [ADR 0002](adr/0002-upload-storage-and-retention.md).

### Durable import jobs

Table: `import_jobs`

Import jobs persist owner/upload/batch links, phase, monotonic progress, attempts, lease owner/expiry, heartbeat, cancellation, result, sanitized error, and lifecycle timestamps.

The worker role may find queued jobs across owners. After claim it reads the persisted owner, opens an owner-context transaction, and performs storage/import/provenance/job writes in that context. Same-owner foreign keys prevent cross-account linkage. See [ADR 0003](adr/0003-import-job-lifecycle.md).

### Rule versions and audited recomputation

Tables:

- `scoring_rules`
- `scoring_rule_changes`
- `score_ledger`

A rule family is identified by `(owner_id, code)`; `(owner_id, code, version)` is its monotonic display version. A GiST exclusion constraint prevents overlapping enabled inclusive ranges within one owner's family.

Rule activation records the authenticated account as actor. The worker claims changes globally, establishes the persisted owner context, then atomically closes the superseded range, enables the proposed UUID, recomputes affected totals, replaces ledger rows, and completes the audit. See [ADR 0004](adr/0004-rule-versioning-and-recomputation.md).

### Raw provenance and canonical facts

Tables:

- `import_batches`
- `source_records`
- `activities`
- `daily_metrics`
- `performance_events`

Every table has non-null ownership. Dates and deterministic source identities are unique within an owner, not globally. Composite foreign keys require source, batch, activity, performance, ledger, and rule links to share the same owner.

### Read models and canonical export

Views:

- `v_daily_summary`
- `v_score_breakdown`
- `v_performance_events`

Views execute with invoker security and operate over RLS-filtered tables. Window calculations partition by owner before the owner column is omitted from public view shapes.

Repositories provide narrow read boundaries:

- `DailyRepository` assembles persisted daily score explanations;
- `CockpitRepository` applies bounded daily ranges;
- `PerformanceRepository` filters events and resolves event provenance;
- `CanonicalExportRepository` reads one owner-scoped repeatable-read snapshot and validates `sportos.canonical-export.v1`.

## Runtime flows

### Sign-in and session

1. Browser requests `/auth/login` with a safe local return path.
2. API stores one-time hashed state plus PKCE verifier and redirects to OIDC.
3. Callback consumes the one-time transaction, exchanges the code, fetches userinfo, and provisions the external identity/account.
4. API creates a random opaque session and CSRF token, storing only digests.
5. Browser receives HttpOnly session and readable CSRF cookies.
6. Angular loads `/auth/session`; protected components are created only after authentication succeeds.
7. Sign-out revokes the server-side session and expires both cookies.

### Authenticated API operation

1. Global guard authenticates the session cookie.
2. Unsafe methods validate the session-bound CSRF token.
3. Controller derives account UUID from the authenticated request, never request body/query input.
4. Service opens an account-scoped transaction.
5. RLS and same-owner constraints filter/validate all repository reads and writes.
6. Missing and foreign identifiers return the same generic error contract.

### Browser upload and import worker

1. Validate one bounded XLSX upload and workbook kind under account context.
2. Reject owner-scoped duplicates, store bytes, insert upload metadata and one owner-scoped job.
3. Worker claims globally using `FOR UPDATE SKIP LOCKED`.
4. Worker reads the claimed owner and establishes its account context.
5. Transactional importer writes raw/canonical/score/provenance rows with that owner.
6. Worker completes or fails the same owner's job with sanitized state.

### Rules Studio and recomputation

1. Authenticated preview reads only the account's facts and rules.
2. Activation ignores any client actor and records the authenticated account.
3. Proposed rule and audit job share the same owner.
4. Worker claims globally, establishes owner context, and publishes recomputation atomically.

### Cockpit query and export

1. Validate dates, ranges, limits, distances, and UUIDs before querying.
2. Execute the repository inside the authenticated account transaction.
3. Normalize database values and return explicit provenance without storage or owner internals.
4. Canonical export reads one owner-scoped repeatable-read snapshot and validates strict fields/order/counts.

## Package responsibilities

| Package or app | Responsibility |
|---|---|
| `apps/api` | OIDC/session/CSRF, account context, HTTP validation, orchestration, canonical reads, export delivery |
| `apps/web` | Authenticated accessible cockpit; no authoritative calculations |
| `apps/worker` | Global claims plus persisted owner-context import/rule execution and legacy CLI |
| `packages/shared` | Serialization schemas, real-date utilities, canonical export contract |
| `packages/domain` | Pure aggregation, scoring, reconciliation, rule validation, preview logic |
| `packages/db` | Identity/session persistence, owner context, typed schema, RLS-compatible repositories, leases, audits, reads, export assembly |
| `packages/importers` | Storage, XLSX extraction, normalization, warnings, import transactions |
| `packages/analytics` | Pure analytics without database dependencies |
| `flyway/sql` | Append-only migrations, ownership constraints, RLS, views, indexes |

## Current risks

- Workbook assumptions are based on a small known sample.
- Local source storage is single-host and needs coordinated database/object backup.
- Production OIDC, runtime-role secrets, monitoring, backup/restoration, and account deletion require deployment operations beyond source code.
- The worker role is a trusted shared-system exception; its broad queue visibility requires strict secret isolation and logs without account data.
- Postgres polling adds periodic load; wake-up acceleration must preserve durable claims.
- Rule recomputation and canonical export remain intentionally bounded.
- Provenance for manual records is structurally unsupported rather than fabricated.
- Provider credential encryption, cursor identity, cross-source deduplication, and time-zone policy remain for issue #15.

Milestone sequencing is tracked in [ROADMAP.md](ROADMAP.md).
