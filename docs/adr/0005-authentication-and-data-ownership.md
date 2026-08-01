# ADR 0005: Authentication and per-account data ownership

- Status: accepted
- Date: 2026-08-01
- Issue: #14

## Context

SportOS was originally a trusted single-user local application. Uploads, jobs, import batches, raw rows, canonical facts, scores, rule versions, audits, performance records, and exports had no account owner. Several business identities were global: one daily row per date, one upload duplicate identity, one active import per upload, one rule family/version sequence, one enabled effective range per rule family, and one active rule change per code.

Adding only an HTTP authentication guard would not make that model multi-user. A repository bug, valid foreign UUID, worker query, or cross-table link could still expose or connect another account's data. Existing local data also needed a repeatable migration that preserved every current UUID and provenance chain.

## Decision

### Identity and sign-in

SportOS does not store passwords. Interactive sign-in uses OpenID Connect Authorization Code flow with PKCE.

An external identity is the immutable pair `(issuer, subject)`. It maps to one internal `accounts.id` UUID. The internal UUID is the ownership key and audit actor; email and display name are profile attributes only.

The API discovers provider endpoints, stores a one-time hashed state and PKCE verifier, exchanges the callback code, fetches provider `userinfo` with the returned access token, and requires a bounded non-empty `sub`. Provider access tokens are not persisted.

New identities receive a new account and account-owned default rule versions. Existing identities update profile metadata while retaining the same account UUID.

### Migrated legacy account

Migration V106 creates fixed legacy account `00000000-0000-4000-8000-000000000001` and backfills all pre-account rows without changing existing upload, job, batch, source-record, activity, performance-event, rule, audit, daily, or ledger UUIDs.

A deployment may map exactly one configured OIDC `(issuer, subject)` to that legacy account using `SPORTOS_LEGACY_OIDC_ISSUER` and `SPORTOS_LEGACY_OIDC_SUBJECT`. The first matching login claims the account atomically. A second identity cannot claim it. Other identities receive new empty accounts.

The local CLI and optional development bootstrap use the legacy account. The bootstrap route is disabled unless an explicit local-only bearer value is configured and must not be exposed in hosted deployments.

### Opaque sessions and CSRF

SportOS issues a random opaque session token. Only its SHA-256 digest is stored in `auth_sessions`; the plaintext token is delivered in an `HttpOnly`, `SameSite=Lax` cookie. Production cookies are `Secure`.

Sessions have bounded idle and absolute expiry, last-seen tracking, and server-side revocation. Disabled accounts cannot authenticate through a stored session. Sign-out revokes the session and expires both browser cookies.

A separate readable cookie contains a random CSRF token. Unsafe authenticated requests must echo it in `X-SportOS-CSRF`; the API verifies cookie/header equality and the digest bound to the active session. Credentialed CORS accepts only the configured web origin. Login return paths must be local paths.

Health, OIDC login/callback, and the explicitly configured development bootstrap are public. All other application routes require an active session; unsafe methods also require CSRF validation.

Angular checks `/auth/session` before creating protected cockpit components. A global 401 returns the browser to the anonymous state and stops protected polling.

### Ownership schema

The following user-visible tables have non-null `owner_id`:

- `uploaded_files`;
- `import_batches`;
- `import_jobs`;
- `source_records`;
- `activities`;
- `daily_metrics`;
- `scoring_rules`;
- `scoring_rule_changes`;
- `score_ledger`;
- `performance_events`.

Authentication control-plane tables are `accounts`, `external_identities`, `auth_sessions`, and `auth_transactions`. They are available only to the API role and schema owner and are excluded from user-facing reads and canonical export.

Global business identities become account scoped, including daily dates, upload duplicate lookup, source/canonical identities, active import jobs, rule family/version uniqueness, enabled rule ranges, and active rule changes.

Cross-table links use composite same-owner foreign keys. Every `owner_id` is immutable after insertion; database triggers reject reassignment.

### RLS and database identities

Flyway runs as the schema owner. Runtime processes use non-superuser, non-owner roles:

- `sportos_app`: authentication control plane and account-scoped application data;
- `sportos_legacy`: account-scoped local CLI/test access fixed to the legacy owner;
- `sportos_worker`: narrow cross-owner queue dispatcher;
- `sportos_worker_data`: account-scoped import and recomputation execution;
- `sportos_data`: shared no-login privilege role excluding authentication tables.

Account-owned tables enable and force RLS. API, legacy, and worker-data roles may access only rows matching `sportos_current_account_id()`.

An account operation reserves one pooled connection, sets `sportos.account_id` for that connection, runs repository-owned transactions on the same connection, and clears the setting before release. This supports transactional repositories without leaking account context between requests.

Without account context, scoped runtime roles see no owned rows. A valid foreign UUID therefore resolves through the same API contract as a nonexistent UUID.

### Split worker authorization

The dispatcher can only:

- select upload metadata needed to dispatch imports;
- select/update import-job lifecycle rows;
- select/update rule-change lifecycle rows.

It has no policy on source records, canonical facts, scoring rules, score ledgers, performance data, or authentication tables.

A claim returns the persisted immutable owner. The runner then opens a separate `sportos_worker_data` connection, establishes that owner context, and performs parsing, provenance writes, canonical writes, scoring, audit transitions, and terminal updates within that account.

Both worker connections are mandatory. The worker fails closed rather than falling back to API or schema-owner credentials.

### Views, export, and enumeration

Owner-aware views execute with invoker security over RLS-filtered tables. Window calculations partition by owner before owner columns are omitted from public shapes.

Canonical export runs in one owner-scoped repeatable-read snapshot and excludes account IDs, authentication data, raw cells, formulas, raw payloads, upload hashes, storage keys, paths, and source bytes.

Controllers validate dates, ranges, limits, numbers, and UUID shapes before repository execution. Foreign and nonexistent identifiers return the same generic not-found response. Errors and logs omit foreign account metadata and source data.

## Migration sequence

- V105.1 creates upgrade-safe `NOLOGIN` runtime-role placeholders.
- V106 creates identity/session tables, creates and backfills the legacy account, adds ownership, converts constraints and links, enables RLS, and recreates owner-aware views.
- V107 removes owner/private identity fields from the public performance view.
- V108 separates dispatcher and worker-data authorization, restricts authentication tables, removes broad future default grants, and makes ownership immutable.

Local Docker initialization creates development login roles. Production deployments provision equivalent identities and deployment-managed credentials separately.

## Threat and ownership matrix

| Threat or object | Enforcement |
|---|---|
| Foreign UUID enumeration | RLS-filtered reads and generic not-found responses |
| Cross-owner insert or link | RLS `WITH CHECK`, non-null ownership, composite same-owner FKs |
| Owner reassignment | immutable-owner triggers |
| Duplicate dates/rules/uploads across accounts | account-scoped keys and indexes |
| Worker mixes canonical data | dispatcher cannot read canonical tables; worker-data connection is account scoped |
| Worker changes job owner | immutable-owner trigger |
| Runtime bypasses RLS | separate non-superuser/non-owner roles; CI uses runtime roles |
| Session theft from JavaScript | HttpOnly opaque cookie; only digest stored |
| Cross-site mutation | SameSite cookie, exact credentialed CORS origin, session-bound CSRF |
| Open redirect | local-path-only return target |
| Legacy data orphaned | fixed owner backfill preserving UUIDs and provenance links |
| Second identity claims migrated data | serialized provisioning and one-account claim check |
| Auth data exposed to worker/shared role | authentication-table grants restricted to app role |
| Export leaks private internals | strict schema and privacy regression tests |

## Consequences

- Account identity remains stable across profile changes.
- Existing local data remains intact and can be claimed by one configured OIDC identity.
- Business identities that were global are reusable independently per account.
- RLS and same-owner constraints provide a mandatory backstop beneath repository code.
- Account context reserves one pooled connection for the operation; pool sizing must account for concurrent requests and workers.
- Queue dispatch and data execution require two worker database identities.
- The dispatcher remains trusted for lifecycle rows and upload object metadata but cannot inspect canonical or authentication data.
- Sign-out is not account deletion. A future audited erasure workflow must coordinate sessions, source objects, provenance, canonical data, rules, jobs, and backups.
- Provider credential encryption, cursors, rate limits, and cross-source identity remain issue #15 work.

## Required evidence

Acceptance requires repeatable evidence for:

- fresh migration and existing-data backfill through V108;
- same business identities coexisting for two accounts;
- ownerless runtime queries returning no account rows;
- valid foreign identifiers returning no data;
- cross-owner links and owner reassignment failing in Postgres;
- one configured identity claiming a migrated account and a second identity being denied;
- session authentication, expiry/revocation, CSRF, public-route, and sign-out behavior;
- account-scoped exports and rule changes;
- dispatcher queue access with denied canonical/source/rule/ledger/auth access;
- import and recomputation workers preserving the claimed owner;
- root typecheck, tests, database integration, worker integration, importer integration, and production build.
