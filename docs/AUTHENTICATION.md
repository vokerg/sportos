# Authentication and account ownership

SportOS uses OpenID Connect (OIDC) Authorization Code flow with PKCE. SportOS does not store passwords. External identities are mapped from the provider's immutable `(issuer, subject)` pair to an internal `accounts.id` UUID, which is the ownership key for uploads, imports, canonical facts, scores, jobs, exports, and rule configuration.

See [ADR 0005](adr/0005-authentication-and-data-ownership.md) for the accepted decision and threat matrix.

## Runtime identities

Flyway runs as the schema owner. Runtime processes must not use that superuser or table owner because PostgreSQL superusers and table owners can bypass row-level security.

SportOS uses these non-superuser roles:

| Role | Purpose | Ownership policy |
|---|---|---|
| `sportos_app` | NestJS API and session persistence | account-owned rows require transaction-local `sportos.account_id` |
| `sportos_worker` | import and rule-change workers | trusted system role may claim globally, then carries the claimed immutable owner into writes |
| `sportos_legacy` | local CLI and compatibility integration tests | fixed legacy account `00000000-0000-4000-8000-000000000001` |
| `sportos_data` | shared privilege role | no login |

The Docker init script creates local-development login roles with development-only passwords. Never reuse those passwords in a deployed environment.

For an existing database volume, migration V105.1 creates missing roles as `NOLOGIN` placeholders so migration V106 is repeatable. Before starting runtime processes, provision deployment-managed login roles or grant `LOGIN` and strong secrets to the placeholders. Keep Flyway credentials separate.

## Ownership model

Migration V106:

- creates accounts, external identities, authorization transactions, and opaque sessions;
- creates one explicit legacy account and backfills all existing rows without changing existing canonical, source, batch, job, rule, or ledger UUIDs;
- adds non-null `owner_id` columns to all user-visible tables;
- changes date, duplicate, job, rule-family, effective-range, and audit uniqueness to account scope;
- replaces cross-table links with same-owner composite foreign keys;
- enables and forces row-level security on account-owned tables;
- recreates account-aware views and window partitions.

A request selects its account only inside a database transaction using `set_config('sportos.account_id', account_uuid, true)`. Outside that transaction the API role sees no account-owned rows. Valid foreign UUIDs therefore resolve through the same 404 contract as nonexistent UUIDs.

The worker role is a documented shared-system exception. It may inspect queues across owners, but a claimed job/change is processed under the persisted owner context. Same-owner foreign keys prevent a worker defect from linking one account's objects to another account's provenance or canonical records.

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

The issuer must use HTTPS except for `localhost`/`127.0.0.1` development. The API discovers the provider endpoints, creates one-time state, nonce, and PKCE verifier records, exchanges the authorization code, fetches OIDC `userinfo`, and provisions or updates the external identity.

Client secrets, database passwords, and provider configuration must be injected by the deployment secret manager. Do not commit them, place them in browser bundles, or log them.

## Sessions and CSRF

SportOS issues a random opaque session token. Only its SHA-256 digest is stored in Postgres. Sessions have bounded idle and absolute expiry, can be revoked immediately, and are returned in a `HttpOnly`, `SameSite=Lax` cookie. Production cookies must be `Secure`.

A second readable cookie contains a random CSRF token. Unsafe requests must echo it in `X-SportOS-CSRF`; the API verifies cookie/header equality and the digest bound to the active server-side session. Credentialed CORS accepts only `SPORTOS_WEB_ORIGIN`.

Sign-out revokes the server-side session and expires both cookies. A browser 401 clears the authenticated cockpit state and prevents protected components from continuing to poll.

## Local development sign-in

`POST /auth/dev-session` exists only for isolated development and requires an explicit `SPORTOS_DEV_AUTH_TOKEN` bearer secret. When the setting is empty, the route is disabled. It signs in as the fixed legacy account and must not be exposed in hosted environments.

A normal development setup should use a local or test OIDC provider and the regular `/auth/login` flow.

## API routes

```text
GET  /auth/login?returnTo=/
GET  /auth/callback
GET  /auth/session
POST /auth/logout
POST /auth/dev-session       optional local-only bootstrap
```

`GET /health`, login, callback, and the explicitly configured development bootstrap are public. All other application routes require an active session. All unsafe protected routes additionally require CSRF validation.

## Deployment checklist

1. Provision a PostgreSQL schema-owner/Flyway identity separately from non-superuser runtime roles.
2. Run migrations through V107 before starting the new runtime.
3. Set strong, unique runtime database credentials through the secret manager.
4. Configure a trusted OIDC issuer and exact API callback URL.
5. Set exact HTTPS web/API origins and `SPORTOS_COOKIE_SECURE=true`.
6. Keep `SPORTOS_DEV_AUTH_TOKEN` unset.
7. Validate same-user access and denied cross-user reads/writes with a non-superuser connection.
8. Back up the database and uploaded-object store together so ownership/provenance links remain consistent.
9. Rotate provider and database secrets without changing internal account UUIDs.
10. Monitor failed OIDC callbacks, expired/revoked sessions, authorization failures, and worker owner-context errors without logging tokens or another account's data.

## Deletion and disabling

Disabling an account prevents new session authentication but does not silently delete provenance. Hosted deletion requires an explicit audited workflow coordinating sessions, uploads/source bytes, jobs, source records, canonical rows, scores, rules, and exports. That lifecycle is not implied by sign-out.
