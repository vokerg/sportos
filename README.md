# SportOS

SportOS is a local-first sports-data cockpit that turns spreadsheet training records into canonical, auditable facts and deterministic scores. It supports authenticated accounts with database-enforced ownership across uploads, imports, canonical facts, scores, jobs, exports, and rule configuration.

## Current capabilities

- bounded browser upload for supported XLSX workbooks;
- replaceable external source-file storage and durable upload metadata;
- Postgres-authoritative import and rule-change jobs with leases, progress, retry, cancellation, and stale recovery;
- retained raw rows and source-to-canonical provenance;
- transactional and idempotent normalization of activities, daily metrics, and performance events;
- deterministic scoring, reconciliation, exact ledger/rule provenance, immutable rule versions, previews, and audited recomputation;
- Daily Log and Run Lab drill-downs with explicit source provenance;
- strict versioned canonical JSON export;
- OIDC Authorization Code + PKCE sign-in with opaque server-side sessions;
- per-account uniqueness, same-owner foreign keys, forced row-level security, and non-enumerating API responses;
- split queue-dispatch and owner-scoped worker execution;
- responsive keyboard-accessible Angular session and cockpit states.

The next authoritative queue item after account ownership is provider ingestion and the first Strava adapter. See [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), [authentication and ownership](docs/AUTHENTICATION.md), [canonical export](docs/CANONICAL_EXPORT.md), and [issue #3](https://github.com/vokerg/sportos/issues/3).

## Not yet implemented

- Strava, Garmin, Google Sheets, or FIT synchronization;
- encrypted provider credential lifecycle and provider backfills;
- hosted object deletion, backup, restoration, and account-erasure workflows;
- streaming or durable hosted-scale export;
- AI analysis.

## Architecture

```text
OIDC provider -> opaque API session -> account-bound database connection
                                      |
browser XLSX / local CLI              v
          |                 forced RLS + same-owner constraints
          v                            |
upload storage + uploaded_files       |
          |                            |
          v                            |
import_jobs -> narrow dispatcher ------+
          |                claimed owner
          v                            |
owner-scoped worker-data executor <----+
          |
          v
import_batches + source_records
          |
          v
activities + daily_metrics + performance_events
          |
          v
scoring_rules + score_ledger + audited rule changes
          |
          v
stable account-scoped reads + canonical export
          |
          v
NestJS API -> Angular cockpit
```

Postgres is authoritative for accounts, sessions, ownership, job state, leases, rule versions, audit history, canonical facts, provenance, and official scores. Workbook bytes remain outside Postgres behind a replaceable storage contract.

Key decisions:

- [ADR 0001](docs/adr/0001-import-transactions-and-identity.md) — import transactions and identity;
- [ADR 0002](docs/adr/0002-upload-storage-and-retention.md) — uploaded-file storage and retention;
- [ADR 0003](docs/adr/0003-import-job-lifecycle.md) — durable import jobs;
- [ADR 0004](docs/adr/0004-rule-versioning-and-recomputation.md) — immutable rule versions and audited recomputation;
- [ADR 0005](docs/adr/0005-authentication-and-data-ownership.md) — OIDC, sessions, ownership, RLS, worker authorization, and migration;
- [Canonical export v1](docs/CANONICAL_EXPORT.md) — stable datasets, ordering, provenance, reconciliation, and privacy exclusions.

## Prerequisites

- Node.js 22
- pnpm 9.12.0
- Docker with Docker Compose
- an OIDC provider for normal sign-in

Use pnpm exclusively. Do not create npm or Yarn lockfiles.

## Local setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
```

The Docker init script creates development-only non-superuser runtime roles. Flyway continues to use the schema-owner credentials; the API, queue dispatcher, owner-scoped worker-data executor, and local CLI use separate URLs from `.env.example`. Existing database volumes should follow the role provisioning notes in [AUTHENTICATION.md](docs/AUTHENTICATION.md).

Configure OIDC:

```dotenv
SPORTOS_OIDC_ISSUER=https://identity.example.com
SPORTOS_OIDC_CLIENT_ID=sportos-local
SPORTOS_OIDC_CLIENT_SECRET=
SPORTOS_API_ORIGIN=http://localhost:3000
SPORTOS_WEB_ORIGIN=http://localhost:4200
SPORTOS_COOKIE_SECURE=false
```

To let one OIDC identity claim data migrated from the former single-user installation, configure both `SPORTOS_LEGACY_OIDC_ISSUER` and `SPORTOS_LEGACY_OIDC_SUBJECT` before that identity's first login. Keep the mapping stable until the claim is verified.

Start the API, web application, and worker in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:worker
```

Open `http://localhost:4200` and sign in. `POST /auth/dev-session` is available only when an explicit `SPORTOS_DEV_AUTH_TOKEN` is configured; keep it unset outside isolated development.

Stop local services with:

```bash
pnpm db:down
```

## Authentication and ownership

SportOS does not store passwords. It maps the OIDC provider's immutable `(issuer, subject)` to an internal account UUID. A random opaque session is stored only as a digest and delivered in an HttpOnly cookie. Unsafe requests require a session-bound CSRF cookie/header pair. Credentialed CORS accepts only `SPORTOS_WEB_ORIGIN`.

Every user-visible row has an owner. API and worker-data operations reserve an account-bound pooled connection, set the account context, run repository-owned transactions on that same connection, and clear the context before release. Forced PostgreSQL RLS filters reads and writes; date, upload, rule-family, job, and audit identities are account scoped; cross-table links use same-owner constraints. A valid foreign UUID returns the same generic 404 as a nonexistent UUID.

The worker uses two non-superuser roles. A narrow dispatcher can inspect and lease queue rows across owners but cannot read source, canonical, scoring, ledger, or authentication tables. A separate worker-data connection executes the claimed import or recomputation under the persisted owner. See [AUTHENTICATION.md](docs/AUTHENTICATION.md) for deployment, migration, CSRF, and role details.

## Workbook imports and review

After sign-in, open **Imports**, select `my_sport` or `run_db`, choose one `.xlsx` file, and queue it. The API validates the extension, MIME signal, ZIP signature, workbook readability, filename, and 20 MB limit. Source bytes are stored outside Postgres; the request returns HTTP `202`, and the independent worker performs the import.

Daily Log, Run Lab, Rules Studio, import history, job state, provenance, and exports are scoped to the signed-in account. Angular never calculates authoritative scores or bypasses the API's owner context.

The local CLI remains available for the fixed legacy account:

```bash
pnpm import:local -- \
  --mySport=/absolute/path/to/my_sport.xlsx \
  --runDb=/absolute/path/to/running-performance.xlsx
```

## Canonical export

The canonical export endpoint downloads `sportos.canonical-export.v1` JSON for a required inclusive range of at most 3,660 days. One repeatable-read transaction assembles account-owned daily summaries, activities, performance events, reconciliation, and explicit provenance. Raw cells, formulas, payload JSON, upload hashes, object keys, paths, account IDs, authentication data, and source bytes are excluded.

## API surface

Public routes:

```text
GET  /health
GET  /auth/login?returnTo=/
GET  /auth/callback
POST /auth/dev-session        explicit local secret only
```

Authenticated routes:

```text
GET  /auth/session
POST /auth/logout

GET  /daily/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=365
GET  /daily/:date/score-breakdown
GET  /performance/best?distanceM=5000&limit=50
GET  /performance/events?distanceM=5000&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=100
GET  /performance/events/:eventId
GET  /exports/canonical?from=YYYY-MM-DD&to=YYYY-MM-DD

GET  /imports?limit=20&offset=0
GET  /imports/:batchId?diagnosticLimit=100&diagnosticOffset=0
POST /imports/upload
GET  /imports/jobs/:jobId
POST /imports/jobs/:jobId/retry
POST /imports/jobs/:jobId/cancel
POST /imports/local-files

GET  /rules
POST /rules/preview
POST /rules/activate
GET  /rules/changes?limit=50
GET  /rules/changes/:changeId
POST /rules/changes/:changeId/retry
POST /rules/changes/:changeId/cancel
```

All unsafe authenticated routes require `X-SportOS-CSRF`. Real dates, ordered ranges, maximum spans, positive distances, limits, and UUIDs are validated before repository execution.

## Validation

Run the root gates used by CI:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Create and migrate a disposable database ending in `_test` or `-test`, then exercise the non-superuser roles:

```bash
pnpm db:up
docker compose exec postgres createdb -U sportos sportos_test
docker compose run --rm \
  -e FLYWAY_URL=jdbc:postgresql://postgres:5432/sportos_test \
  flyway migrate

SPORTOS_TEST_DATABASE_URL=postgres://sportos_legacy:sportos_legacy@localhost:5432/sportos_test \
SPORTOS_OWNER_TEST_DATABASE_URL=postgres://sportos_app:sportos_app@localhost:5432/sportos_test \
  pnpm --filter @sportos/db test:integration
SPORTOS_TEST_DATABASE_URL=postgres://sportos_worker:sportos_worker@localhost:5432/sportos_test \
SPORTOS_WORKER_DATA_DATABASE_URL=postgres://sportos_worker_data:sportos_worker_data@localhost:5432/sportos_test \
  pnpm --filter @sportos/worker test:integration
SPORTOS_TEST_DATABASE_URL=postgres://sportos_legacy:sportos_legacy@localhost:5432/sportos_test \
  pnpm --filter @sportos/importers test:integration
```

The suites cover migrations through V108, owner isolation, immutable ownership, cross-user negative cases, legacy identity claim, import and rule-job dispatch, denied dispatcher access to canonical data, owner-scoped worker execution, transactional imports, exact ledger UUIDs, canonical export privacy/provenance, API session/CSRF validation, cockpit states, and production builds.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before changing authentication, ownership, imports, jobs, scoring rules, migrations, read models, or exports.
