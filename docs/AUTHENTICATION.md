# Authentication and account ownership

SportOS uses OpenID Connect (OIDC) Authorization Code flow with PKCE and does not store passwords. External identities map from the provider's immutable `(issuer, subject)` pair to an internal `accounts.id` UUID. That UUID owns uploads, imports, canonical facts, scores, jobs, exports, and rule configuration.

See [ADR 0005](adr/0005-authentication-and-data-ownership.md) for the accepted decision and threat matrix.

## Runtime identities

Flyway runs as the schema owner. Runtime processes must not use that superuser or table owner because PostgreSQL superusers and table owners can bypass row-level security.

SportOS uses these non-superuser roles:

| Role | Purpose | Ownership policy |
|---|---|---|
| `sportos_app` | NestJS API, identity provisioning, and session persistence | account-owned rows require transaction-local `sportos.account_id`; auth control-plane tables are app-only |
| `sportos_worker` | queue dispatcher | may select upload metadata and select/update import/rule queue rows across owners; cannot read source, canonical, scoring, ledger, or auth tables |
| `sportos_worker_data` | import and recomputation execution | uses the claimed immutable owner through ordinary account-isolation policies |
| `sportos_legacy` | local CLI and compatibility integration tests | fixed legacy account `00000000-0000-4000-8000-000000000001` |
| `sportos_data` | shared privilege role | no login; authentication control-plane tables are explicitly excluded |

The worker requires both dispatcher and data connections and fails closed if either is absent. A single broad worker connection is not supported.

The Docker init script creates local-development login roles with development-only credentials. Never reuse those credentials in a deployment. Existing database volumes receive `NOLOGIN` placeholders through migration V105.1; provision deployment-managed login identities before starting runtime processes.

## Ownership model

Migration V106:

- creates accounts, external identities, authorization transactions, and opaque sessions;
- creates one explicit legacy account and backfills existing rows without changing canonical, source, batch, job, rule, or ledger UUIDs;
- adds non-null `owner_id` columns to all user-visible tables;
- changes date, duplicate, job, rule-family, effective-range, and audit uniqueness to account scope;
- replaces cross-table links with same-owner composite foreign keys;
- enables and forces row-level security;
- recreates account-aware views and window partitions.

Migration V107 keeps owner/private identity fields out of the public performance view. Migration V108 separates cross-owner queue dispatch from owner-scoped worker data access, removes authentication-table access from the shared privilege role, makes future table grants explicit, and makes every `owner_id` immutable.

A request selects its account only inside a database transaction using `set_config('sportos.account_id', account_uuid, true)`. Outside that transaction the API and worker-data roles see no account-owned rows. Valid foreign UUIDs therefore resolve through the same generic result as nonexistent UUIDs.

The dispatcher is a narrow shared-system exception. It can locate and lease work across accounts but cannot read the facts used by imports or recomputation. Its claim result includes the persisted owner; the data executor then opens a separate account-scoped transaction. Same-owner foreign keys and immutable owner columns prevent cross-account reassignment or linkage.

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

Provider configuration, database credentials, and session material must be injected by deployment configuration. Do not commit them, place them in browser bundles, or log them.

## Sessions and CSRF

SportOS issues a random opaque session token. Only its SHA-256 digest is stored in Postgres. Sessions have bounded idle and absolute expiry, can be revoked immediately, and are returned in a `HttpOnly`, `SameSite=Lax` cookie. Production cookies must be `Secure`.

A second readable cookie contains a random CSRF token. Unsafe requests must echo it in `X-SportOS-CSRF`; the API verifies cookie/header equality and the digest bound to the active server-side session. Credentialed CORS accepts only `SPORTOS_WEB_ORIGIN`.

Sign-out revokes the server-side session and expires both cookies. A browser 401 clears the authenticated cockpit state and prevents protected components from continuing to poll.

## Local development sign-in

`POST /auth/dev-session` exists only for isolated development and requires an explicit `SPORTOS_DEV_AUTH_TOKEN` bearer value. When the setting is empty, the route is disabled. It signs in as the fixed legacy account and must not be exposed in hosted environments.

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

## Deployment checklist

1. Provision a PostgreSQL schema-owner/Flyway identity separately from runtime identities.
2. Provision distinct API, queue-dispatch, worker-data, and legacy identities.
3. Run migrations through V108 before starting the new runtime.
4. Configure both `SPORTOS_WORKER_DATABASE_URL` and `SPORTOS_WORKER_DATA_DATABASE_URL`; never point either at the schema owner.
5. Configure a trusted OIDC issuer and exact API callback URL.
6. Set exact HTTPS web/API origins and `SPORTOS_COOKIE_SECURE=true`.
7. Keep `SPORTOS_DEV_AUTH_TOKEN` unset.
8. Validate same-user access, denied cross-user access, and that the dispatcher cannot read canonical or auth tables.
9. Back up the database and uploaded-object store together so ownership/provenance links remain consistent.
10. Monitor failed OIDC callbacks, expired/revoked sessions, authorization failures, and worker owner-context errors without logging tokens or another account's data.

## Deletion and disabling

Disabling an account prevents new session authentication but does not silently delete provenance. Hosted deletion requires an explicit audited workflow coordinating sessions, uploads/source bytes, jobs, source records, canonical rows, scores, rules, and exports. That lifecycle is not implied by sign-out.
