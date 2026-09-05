# Authentication and account ownership

SportOS uses OpenID Connect (OIDC) Authorization Code flow with PKCE and does not store passwords. External identities map from the provider's immutable `(issuer, subject)` pair to an internal `accounts.id` UUID. That UUID owns uploads, imports, canonical facts, scores, jobs, exports, rule configuration, and analysis audit metadata.

See [ADR 0005](adr/0005-authentication-and-data-ownership.md) for the accepted identity decision and threat matrix, and [ADR 0007](adr/0007-read-only-ai-analysis.md) for the analysis authorization and audit boundary.

## Runtime identities

Flyway runs as the schema owner. Runtime processes must not use that superuser or table owner because PostgreSQL superusers and table owners can bypass row-level security.

SportOS uses these non-superuser roles:

| Role | Purpose | Ownership policy |
|---|---|---|
| `sportos_app` | NestJS API, identity provisioning, session persistence, account-scoped reads, and append-only analysis audit inserts | account-owned work reserves one pooled connection, sets `sportos.account_id` for that connection, and clears it before release; auth/provider credential/analysis-audit control planes are app-only |
| `sportos_worker` | queue dispatcher | may select upload metadata and select/update import/rule/provider queue rows across owners; cannot read source, canonical, scoring, ledger, analysis audit, provider credential, or auth tables |
| `sportos_worker_data` | import, provider-sync, and recomputation execution | uses the claimed immutable owner through ordinary account-isolation policies; cannot read analysis audit rows |
| `sportos_legacy` | local CLI and compatibility integration tests | fixed legacy account `00000000-0000-4000-8000-000000000001`; cannot read analysis audit rows |
| `sportos_data` | shared privilege role | no login; authentication, provider credential, and analysis audit control planes are explicitly excluded |

The worker requires both dispatcher and data connections and fails closed if either is absent. A single broad worker connection is not supported.

Neon must provision the runtime login roles with deployment-managed credentials. Never reuse runtime credentials for migrations. Migration V105.1 creates upgrade-safe `NOLOGIN` placeholders when a role is absent; the Neon schema-owner identity must provision login capability before starting runtime processes.

## Ownership model

Migration V106:

- creates accounts, external identities, authorization transactions, and opaque sessions;
- creates one explicit legacy account and backfills existing rows without changing canonical, source, batch, job, rule, or ledger UUIDs;
- adds non-null `owner_id` columns to all user-visible tables;
- changes date, duplicate, job, rule-family, effective-range, and audit uniqueness to account scope;
- replaces cross-table links with same-owner composite foreign keys;
- enables and forces row-level security;
- recreates account-aware views and window partitions.

Migration V107 keeps owner/private identity fields out of the public performance view. Migration V108 separates cross-owner queue dispatch from owner-scoped worker data access, removes authentication-table access from the shared privilege role, makes future table grants explicit, and makes every `owner_id` immutable. Migration V109 applies the same owner/RLS/least-privilege model to provider connections, encrypted credentials, OAuth state, sync jobs, and activity links.

Migration V110 adds `analysis_runs`. It is forced-RLS account data, but it is intentionally append-only for `sportos_app`: the role may `SELECT` and `INSERT`, not `UPDATE` or `DELETE`. Dispatcher, worker-data, legacy, and shared roles cannot read it. V112 adds the same owner-scoped append-only boundary for `daily_score_snapshots`; the API and worker-data roles may append/read their account's score history, while the queue dispatcher cannot access it. The migration asserts those privileges.

Account-owned repository work reserves one connection from the Kysely pool and sets `sportos.account_id` on that connection with `set_config(..., false)`. Repository-owned transactions can run on the same reserved connection. A `finally` block clears the setting before the connection returns to the pool. Without a selected account, API and worker-data roles see no account-owned rows. Valid foreign UUIDs therefore resolve through the same generic result as nonexistent UUIDs.

The dispatcher is a narrow shared-system exception. It can locate and lease work across accounts but cannot read the facts used by imports or recomputation. Its claim result includes the persisted owner; the data executor then opens a separate account-scoped connection. Same-owner foreign keys and immutable owner columns prevent cross-account reassignment or linkage.

Analysis is not a dispatcher exception. It always runs under the authenticated API account context and reuses ordinary read services. The browser and generator cannot submit an owner ID. Dedicated integration creates two owners with the same date and proves that facts, citations, and audit rows remain isolated.

## OIDC configuration

Required settings:

```dotenv
SPORTOS_OIDC_ISSUER=https://identity.example.com
SPORTOS_OIDC_CLIENT_ID=sportos
SPORTOS_OIDC_CLIENT_SECRET=
SPORTOS_API_ORIGIN=https://api.example.com
SPORTOS_WEB_ORIGIN=https://sportos.example.com
SPORTOS_COOKIE_SECURE=true
```

The issuer must use HTTPS except for `localhost` or `127.0.0.1` development. The API discovers provider endpoints, creates one-time state and PKCE records, exchanges the authorization code, fetches OIDC `userinfo`, and provisions or updates the external identity.

Provider configuration, optional AI-generator configuration, database credentials, and session material must be injected by deployment configuration. Do not commit them, place them in browser bundles, or log them.

## Sessions and CSRF

SportOS issues a random opaque session token. Only its SHA-256 digest is stored in Postgres. Sessions have bounded idle and absolute expiry, can be revoked immediately, and are returned in a `HttpOnly`, `SameSite=Lax` cookie. Production cookies must be `Secure`.

A second readable cookie contains a random CSRF token. Unsafe requests must echo it in `X-SportOS-CSRF`; the API verifies cookie/header equality and the digest bound to the active server-side session. Credentialed CORS accepts only `SPORTOS_WEB_ORIGIN`.

Analysis uses `POST` because it accepts bounded structured questions and may insert audit metadata. Both `/analysis/tools/execute` and `/analysis/answers` therefore require the normal session-bound CSRF validation even though the canonical tools are read-only.

Sign-out revokes the server-side session and expires both cookies. A browser 401 clears the authenticated cockpit state and prevents protected components from continuing to poll or issue analysis requests.

## Analysis audit privacy

`analysis_runs` stores only:

- the owning account internally;
- SHA-256 hash of the bounded question or tool-only request descriptor;
- tool name and date/range input summary;
- citation/source identifier keys;
- generator/provider/model metadata;
- outcome and data-quality status; and
- timestamp.

It does not store raw questions, generated answers, prompts, official fact payloads, imported notes, filenames, source/upload hashes, provider payloads, credentials, session material, or account profile fields. Public answers expose an audit UUID but never the owner ID.

An optional external JSON generator receives a bounded question and sanitized official tool result only when explicitly configured. Operators are responsible for that endpoint's access control, retention, regional processing, and vendor terms. See [AI_ANALYSIS.md](AI_ANALYSIS.md).

## Local development sign-in

`SPORTOS_AUTH_MODE=dev-single-user` is the simplest local mode: protected API routes resolve the fixed legacy account directly, so every browser can open the app without sharing cookies. It must not be used for hosted or multi-user deployments. OIDC remains available when this setting is unset.

`POST /auth/dev-session` remains available as an explicit local-only session bootstrap when `SPORTOS_DEV_AUTH_TOKEN` is configured, but it is not needed in `dev-single-user` mode.

A normal development setup should use a local or test OIDC provider and the regular `/auth/login` flow.

## API routes

```text
GET  /auth/login?returnTo=/
GET  /auth/callback
GET  /auth/session
POST /auth/logout
POST /auth/dev-session       optional local-only bootstrap
```

`GET /health`, login, callback, and the explicitly configured development bootstrap are public. All other application routes require an active session. Unsafe protected routes additionally require CSRF validation.

The daily score authority transition is a protected unsafe route:
`POST /daily/:date/recalculate`. It derives the account from the authenticated
session, requires the normal CSRF header, and never accepts an owner ID in the
request body.

## Deployment checklist

1. Provision a PostgreSQL schema-owner/Flyway identity separately from runtime identities.
2. Provision distinct API, queue-dispatch, worker-data, and legacy identities.
3. Run migrations through V112 before starting the new runtime.
4. Configure both `SPORTOS_WORKER_DATABASE_URL` and `SPORTOS_WORKER_DATA_DATABASE_URL`; never point either at the schema owner.
5. Configure a trusted OIDC issuer and exact API callback URL.
6. Set exact HTTPS web/API origins and `SPORTOS_COOKIE_SECURE=true`.
7. Keep `SPORTOS_DEV_AUTH_TOKEN` unset.
8. Leave `SPORTOS_AI_JSON_ENDPOINT` and `SPORTOS_AI_MODEL` empty unless an approved operator-controlled endpoint and retention policy exist.
9. When external generation is enabled, keep the API key server-side, require HTTPS, bound the timeout, and monitor failures without logging questions or records.
10. Validate same-user access, denied cross-user access, account-context cleanup, and that dispatcher/worker/legacy roles cannot read canonical, auth, provider credential, or analysis audit tables.
11. Validate that `sportos_app` cannot update or delete `analysis_runs` and that raw questions/generated answers are absent from audit rows.
12. Back up the database and uploaded-object store together so ownership/provenance links remain consistent.
13. Monitor failed OIDC callbacks, expired/revoked sessions, authorization failures, model-gateway failures, and worker owner-context errors without logging tokens or another account's data.

## Deletion and disabling

Disabling an account prevents new session authentication but does not silently delete provenance or append-only analysis audit metadata. Hosted deletion requires an explicit audited workflow coordinating sessions, uploads/source bytes, jobs, source records, canonical rows, scores, rules, analysis audits, and exports. That lifecycle is not implied by sign-out.
