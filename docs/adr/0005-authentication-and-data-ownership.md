# ADR 0005: OIDC authentication and per-account data ownership

- Status: proposed
- Date: 2026-08-01
- Issue: #14

## Context

SportOS currently assumes one trusted local user. Every upload, job, import batch, source record, canonical fact, scoring rule, score ledger row, rule-change audit, and export query is globally visible. Repository methods accept bare identifiers, worker claims carry no account context, and several important identities are globally unique:

- `daily_metrics.metric_date` is one global row per date;
- duplicate uploads are detected globally by workbook hash and kind;
- scoring-rule `(code, version)` and enabled effective ranges are global;
- active import and rule-change constraints are global;
- API CORS currently accepts any origin and no authenticated session exists.

Adding an API guard alone would be insufficient. Ownership must be represented in persistent identities, foreign keys, uniqueness constraints, repository contracts, job claims, worker writes, exports, and browser session behavior.

SportOS must also migrate existing local data without changing canonical UUIDs or orphaning provenance.

## Decision

### Identity provider strategy

SportOS will use standards-based OpenID Connect Authorization Code flow with PKCE. SportOS will not store user passwords, password-reset tokens, or long-lived identity-provider access tokens unless a later provider-specific ADR requires them.

An external identity is keyed by the immutable pair `(issuer, subject)`. Email, display name, and avatar are profile snapshots only and never determine ownership or authorization.

The internal authorization principal is an immutable SportOS account UUID. All owned rows reference this UUID through `owner_id`.

Local development will use a standards-compliant local OIDC provider or a configured development issuer. There is no application-level authentication bypass and no trusted user identity supplied by an arbitrary request header.

### Account and identity tables

The ownership migration creates:

#### `accounts`

- `id uuid primary key`;
- display/profile fields that may be updated from verified OIDC claims;
- account status (`active`, `disabled`);
- creation/update timestamps;
- optional `claimed_at` for the migrated local account.

#### `account_identities`

- `id uuid primary key`;
- `account_id` foreign key;
- normalized OIDC `issuer` and `subject`;
- last verified profile claims and verification timestamp;
- unique `(issuer, subject)`;
- one external identity may belong to only one account.

#### `auth_sessions`

- `id uuid primary key`;
- `account_id` foreign key;
- SHA-256 hash of a cryptographically random opaque session token;
- SHA-256 hash of a separate CSRF token;
- created, last-seen, idle-expiry, absolute-expiry, and revoked timestamps;
- optional sanitized user-agent metadata;
- unique token hash.

The raw session and CSRF tokens are never stored in Postgres or logs.

### OIDC login flow

1. `GET /auth/login` creates a short-lived authorization transaction containing state, nonce, PKCE verifier/challenge, and safe post-login return path.
2. The browser is redirected to the configured issuer.
3. `GET /auth/callback` verifies state, nonce, issuer, audience, signature, expiry, and PKCE before trusting claims.
4. `(issuer, subject)` resolves or provisions an internal account.
5. The API creates an opaque server-side session and sets cookies.
6. `GET /auth/session` returns only the current internal account UUID and safe profile fields.
7. `POST /auth/logout` revokes the session and clears cookies.

Authorization transaction records are short lived and single use. Callback and session errors do not reveal whether another account exists.

### Session and cookie policy

The session cookie is:

- `HttpOnly`;
- `Secure` outside explicit loopback development;
- `SameSite=Lax`;
- scoped to `/`;
- opaque and random;
- rotated after successful login and privilege-sensitive changes;
- bounded by idle and absolute expiry.

The browser never stores session or identity-provider tokens in `localStorage` or `sessionStorage`.

Unsafe authenticated methods require both:

- a valid same-site session cookie; and
- a matching CSRF token sent in a custom request header.

The API additionally validates the exact configured web origin on unsafe requests. CORS uses an explicit allowlist with credentials; `origin: true` is removed.

### Bootstrap and existing-data migration

The migration creates one fixed legacy account UUID for all pre-authentication local data. The UUID is constant in migration SQL so a fresh database and an upgraded database produce the same bootstrap owner identity.

All existing owned rows are backfilled to that account without changing their existing row UUIDs or source/provenance links.

A deployment may configure one bootstrap OIDC `(issuer, subject)` pair. The first successful login for that exact identity atomically claims the unclaimed legacy account. No other identity can claim it. If no bootstrap identity is configured, the legacy account remains disabled/unclaimed until an explicit operator action is added.

Other valid OIDC identities provision new empty accounts. New accounts receive account-scoped default scoring-rule versions in one transaction. Existing migrated scoring-rule UUIDs remain unchanged for the legacy account.

Email matching is never used to claim or merge accounts.

### Owned tables

The following tables gain `owner_id uuid not null references accounts(id) on delete restrict`:

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

Every owned table also has a unique `(owner_id, id)` key when needed as the target of an ownership-preserving composite foreign key.

### Ownership-preserving references

Foreign keys are converted or supplemented so parent and child owners must match in Postgres:

- import batch -> uploaded file;
- import job -> uploaded file and import batch;
- source record -> import batch;
- activity -> source record;
- daily metric -> source record;
- performance event -> activity and source record;
- score ledger -> activity and scoring rule;
- rule change -> previous and proposed scoring-rule versions.

An application bug therefore cannot connect one account's child row to another account's parent row.

Nullable provenance references stay nullable, but when present they must match the same owner.

### Account-scoped identities and constraints

Global business identities become account scoped:

- daily metric primary key: `(owner_id, metric_date)`;
- duplicate upload lookup: `(owner_id, sha256, workbook_kind, created_at desc)` for non-deleted uploads;
- scoring-rule version uniqueness: `(owner_id, code, version)`;
- enabled rule exclusion: `(owner_id, code, inclusive daterange)`;
- active rule-change uniqueness: `(owner_id, rule_code)`;
- active import uniqueness: account-scoped upload identity;
- deterministic canonical identities and import upserts include `owner_id`.

Queue limits are enforced per account so one account cannot exhaust another account's allowance. A separate global worker safety cap may remain as an operational limit but cannot replace the per-account boundary.

### Repository contract

Every user-facing repository read or write requires an `ownerId` argument or an owner-bound repository instance. Bare identifiers are not sufficient.

Queries use both `owner_id` and the supplied identifier. A syntactically valid identifier belonging to another account returns the same not-found result as a nonexistent identifier. APIs do not expose an authorization distinction that permits identifier enumeration.

Insert and upsert paths explicitly write `owner_id`; no table relies on an ambient database default for ownership.

Shared-system repositories such as health checks and migration metadata remain unowned and cannot expose user data.

### API authentication and authorization

All application routes require an authenticated session except:

- `GET /health`;
- OIDC login/callback endpoints;
- any narrowly required issuer metadata/probe route.

A NestJS guard resolves the session and attaches an immutable authenticated principal. Controllers pass only `principal.accountId` into service/repository operations; request bodies and query strings can never select an owner.

Upload, import-job, history, diagnostics, daily, performance, rule, rule-change, and export endpoints are all account scoped. Cross-account valid UUIDs return the existing not-found contracts without foreign metadata.

Errors and logs omit foreign filenames, hashes, source rows, job phases, account profiles, and existence information.

### Worker ownership

A claimed import job or rule-change job includes its `ownerId`.

Worker operations preserve that owner through:

- upload object reads and upload status changes;
- import batch creation and linking;
- raw source-record writes;
- canonical activity, daily, performance, and ledger writes;
- rule activation and score recomputation;
- job heartbeat, cancellation, retry, result, and terminal updates.

Every worker mutation uses both the row identifier and expected owner in addition to lease-owner predicates. A job cannot write a batch, fact, rule, or ledger row owned by another account.

Storage object keys remain opaque random values and are not derived from account identifiers, emails, or subjects.

### Browser session behavior

Angular obtains session state from `GET /auth/session` using credentialed requests.

When unauthenticated, the cockpit renders a sign-in surface and does not issue protected data requests. On sign-out or session expiry, it:

- clears in-memory rows, details, previews, upload/job state, and downloadable export references;
- stops polling and cancels active HTTP subscriptions;
- navigates to the signed-out surface;
- does not retain account data in browser storage.

Unsafe requests include the CSRF header through one HTTP interceptor. Session expiry produces one consistent re-authentication path rather than retry loops.

### Threat and ownership matrix

| Asset or operation | Owner key | Enforcement | Cross-account response |
|---|---|---|---|
| uploaded bytes/object metadata | `uploaded_files.owner_id` | account-scoped upload row; opaque key; worker uses claimed owner | not found; no filename/key disclosure |
| duplicate workbook lookup | upload owner | owner included in hash/kind lookup | another account's hash is not a duplicate |
| import job, retry, cancel | `import_jobs.owner_id` | owner + job UUID; worker owner + lease | not found |
| import batch/history/diagnostics | `import_batches.owner_id` | owner-scoped list/detail and composite provenance FKs | not found/omitted from list |
| raw source record | `source_records.owner_id` | owner-scoped batch FK; never public raw payload | not found |
| activity/daily/performance facts | row `owner_id` | account-scoped deterministic identity and reads | not found/omitted |
| scoring rule/version | `scoring_rules.owner_id` | owner-scoped family uniqueness/range exclusion | not found/omitted |
| rule-change audit/job | `scoring_rule_changes.owner_id` | owner-scoped enqueue/read/retry/cancel and worker lease | not found |
| score ledger | `score_ledger.owner_id` | same-owner rule/activity FKs and daily queries | omitted |
| canonical export | authenticated account | repository receives only session account UUID | contains only caller's rows |
| session token | `auth_sessions.account_id` | opaque cookie; hashed at rest; expiry/revocation | generic unauthenticated response |
| logs and errors | none | structured redaction and anti-enumeration | no foreign existence/data |

### Shared-system exceptions

The following are intentionally not user-owned:

- Flyway migration history;
- health status;
- static application configuration;
- worker process identity and global operational safety limits;
- OIDC issuer configuration;
- immutable default-rule templates used only to provision account-owned rule rows.

No shared exception may contain user workbook data, provenance, canonical facts, official scores, or account-specific rule configuration.

### Migration strategy

The ownership migration is append only and is expected to be V106.

The migration will:

1. create account, identity, authorization-transaction, and session tables;
2. insert the fixed legacy account;
3. add nullable `owner_id` columns;
4. backfill every existing row to the legacy account in dependency order;
5. replace global primary/unique/exclusion constraints with account-scoped variants;
6. add ownership-preserving composite unique keys and foreign keys;
7. validate cross-table owner consistency;
8. make every owned `owner_id` non-null;
9. recreate owner-aware views and indexes;
10. seed/provision account-scoped default rule templates without changing migrated rule UUIDs.

Upgrade evidence must start with a populated V105 database and prove that existing UUIDs, totals, job/audit histories, and source chains survive unchanged apart from the new owner columns.

Rollback is restore-from-backup or a forward corrective migration. Destructive ownership downgrade is not supported.

## Consequences

- Every user-visible record has an explicit owner or documented shared-system exception.
- Repository and worker signatures become more verbose because owner context is mandatory.
- Existing globally keyed dates/rule families become safely reusable by different accounts.
- Cross-account identifiers are non-enumerable through public contracts.
- Sessions can be revoked centrally without exposing identity-provider tokens to Angular.
- Local development requires an OIDC provider/configuration instead of an implicit trusted user.
- Account deletion and full data erasure need a separate lifecycle design because current provenance uses restrictive foreign keys.
- Team sharing, delegated access, and role-based administration remain out of scope.

## Evidence required before acceptance

The ADR becomes accepted only when repeatable evidence proves:

- fresh migration and populated V105 upgrade through the ownership migration;
- complete ownership backfill with unchanged existing UUID/provenance chains;
- same-account reads/writes and denied cross-account reads/writes for uploads, jobs, imports, facts, rules, rule changes, ledger, and export;
- valid foreign UUIDs return the same not-found response as nonexistent UUIDs;
- worker claims carry owner context and cannot mutate another account's rows;
- duplicate detection, daily identities, rule versions, rule overlap, and queue limits are account scoped;
- session creation, expiry, revocation, CSRF, exact-origin CORS, and safe sign-out;
- logs/errors do not disclose foreign account data;
- Angular signed-in/signed-out/session-expired workflows;
- root typecheck, unit/component tests, database integration, worker integration, importer integration, and production build.
