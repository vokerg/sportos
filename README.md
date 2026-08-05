# SportOS

SportOS is a local-first sports-data cockpit that turns training records and connected provider activity into canonical, auditable facts and deterministic scores. It supports authenticated accounts with database-enforced ownership across uploads, provider connections, imports, canonical facts, scores, jobs, exports, rule configuration, and cited read-only analysis.

## Current capabilities

- bounded browser upload for supported XLSX workbooks;
- replaceable external source-file storage and durable upload metadata;
- Postgres-authoritative import, provider-sync, and rule-change jobs with leases, progress, retry, cancellation, and stale recovery;
- retained raw workbook rows and raw provider snapshots with source-to-canonical provenance;
- transactional and idempotent normalization of activities, daily metrics, and performance events;
- Strava OAuth connection, rotating-token refresh, initial backfill, incremental synchronization, rate-limit rescheduling, retry, cancellation, and disconnect;
- application-layer AES-256-GCM provider credential encryption with versioned keys and owner/connection-bound authentication data;
- deterministic cross-source identity handling that links one exact workbook/provider match, creates new canonical facts when no match exists, and surfaces ambiguous collisions;
- deterministic scoring, reconciliation, exact ledger/rule provenance, immutable rule versions, previews, and audited recomputation;
- Daily Log and Run Lab drill-downs with explicit source provenance;
- cited read-only analysis over stable account-scoped reads, with deterministic calculations, strict generated-answer sections, safe fallback, and append-only audit metadata;
- strict versioned canonical JSON export;
- OIDC Authorization Code + PKCE sign-in with opaque server-side sessions;
- per-account uniqueness, same-owner foreign keys, forced row-level security, and non-enumerating API responses;
- split queue-dispatch and owner-scoped worker execution;
- responsive keyboard-accessible Angular session, provider, analysis, and cockpit states.

The authoritative ordered roadmap is complete through issue #16. See [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), [read-only analysis operations](docs/AI_ANALYSIS.md), [authentication and ownership](docs/AUTHENTICATION.md), [canonical export](docs/CANONICAL_EXPORT.md), and [issue #3](https://github.com/vokerg/sportos/issues/3).

## Not yet implemented

- Garmin, Google Sheets, or FIT synchronization;
- automated processing of provider webhook hints beyond the bounded durable inbox schema;
- hosted object deletion, backup, restoration, key-management-service integration, and account-erasure workflows;
- streaming or durable hosted-scale export;
- hosted model-gateway operations, semantic evaluation beyond the bounded repository cases, and additional analysis tools.

## Architecture

```text
OIDC provider -> opaque API session -> account-bound database connection
                                      |
browser XLSX / Strava OAuth           v
          |                 forced RLS + same-owner constraints
          v                            |
upload storage / encrypted tokens     |
          |                            |
          v                            |
import_jobs / provider_sync_jobs ------+
          |                claimed owner
          v                            |
narrow queue dispatcher               |
          |                            |
          v                            |
owner-scoped worker-data executor <----+
          |
          v
import_batches + source_records
          |
          v
activities + provider_activity_links + performance_events
          |
          v
daily_metrics + scoring_rules + score_ledger + audited changes
          |
          v
stable account-scoped reads + deterministic analysis tools + canonical export
          |                              |
          |                              v
          |                  validated generator + analysis_runs audit
          |                              |
          +------------------------------+
                         |
                         v
               NestJS API -> Angular cockpit
```

Postgres is authoritative for accounts, sessions, ownership, provider connection metadata, encrypted credential envelopes, cursors, job state, leases, rule versions, audit history, canonical facts, provenance, official scores, and append-only analysis-run metadata. Workbook bytes remain outside Postgres behind a replaceable storage contract. Provider tokens are stored only inside authenticated encrypted envelopes and never returned to the browser or dispatcher. Generated guidance is non-authoritative and never persists official calculations.

Key decisions:

- [ADR 0001](docs/adr/0001-import-transactions-and-identity.md) — import transactions and identity;
- [ADR 0002](docs/adr/0002-upload-storage-and-retention.md) — uploaded-file storage and retention;
- [ADR 0003](docs/adr/0003-import-job-lifecycle.md) — durable import jobs;
- [ADR 0004](docs/adr/0004-rule-versioning-and-recomputation.md) — immutable rule versions and audited recomputation;
- [ADR 0005](docs/adr/0005-authentication-and-data-ownership.md) — OIDC, sessions, ownership, RLS, worker authorization, and migration;
- [ADR 0006](docs/adr/0006-provider-ingestion-and-strava.md) — provider adapters, encrypted credentials, durable synchronization, raw provenance, and cross-source identity;
- [ADR 0007](docs/adr/0007-read-only-ai-analysis.md) — narrow analysis tools, deterministic calculations, citation validation, generation, audit, and UI separation;
- [Canonical export v1](docs/CANONICAL_EXPORT.md) — stable datasets, ordering, provenance, reconciliation, and privacy exclusions.

## Prerequisites

- Node.js 22
- pnpm 9.12.0
- Docker with Docker Compose
- an OIDC provider for normal sign-in
- optional Strava API application for provider synchronization
- optional operator-controlled HTTPS JSON model endpoint for external generated guidance

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

Optional Strava setup:

1. Register the exact callback URL, such as `http://localhost:3000/providers/strava/callback`, in the Strava API application.
2. Generate at least one 32-byte credential-encryption key outside source control.
3. Configure the same provider secrets and key ring for both the API and worker processes.

```dotenv
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=http://localhost:3000/providers/strava/callback
SPORTOS_PROVIDER_CREDENTIAL_KEYS=k1=<base64-encoded-32-byte-key>
SPORTOS_PROVIDER_ACTIVE_KEY_ID=k1
```

For key rotation, add the new `keyId:key` entry, retain old keys for decryption, and change `SPORTOS_PROVIDER_ACTIVE_KEY_ID`. Refreshed or reauthorized credentials are then written with the active key. Removing an old key before all envelopes have rotated makes those connections require reauthorization.

Read-only analysis uses the deterministic local fallback by default and sends no records to an external model. Optional external generation requires an operator-controlled endpoint:

```dotenv
SPORTOS_AI_JSON_ENDPOINT=https://model-gateway.example.com/sportos-analysis
SPORTOS_AI_MODEL=approved-model-name
SPORTOS_AI_API_KEY=
SPORTOS_AI_TIMEOUT_MS=15000
```

See [AI_ANALYSIS.md](docs/AI_ANALYSIS.md) for the exact request/response schema, privacy boundary, fallback behavior, and deployment responsibilities.

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

## Authentication, ownership, provider credentials, and analysis audit

SportOS does not store passwords. It maps the OIDC provider's immutable `(issuer, subject)` to an internal account UUID. A random opaque session is stored only as a digest and delivered in an HttpOnly cookie. Unsafe requests require a session-bound CSRF cookie/header pair. Credentialed CORS accepts only `SPORTOS_WEB_ORIGIN`.

Every user-visible row has an owner. API and worker-data operations reserve an account-bound pooled connection, set the account context, run repository-owned transactions on that same connection, and clear the context before release. Forced PostgreSQL RLS filters reads and writes; provider, date, upload, rule-family, job, audit, and analysis-run identities are account scoped; cross-table links use same-owner constraints. A valid foreign UUID returns the same generic result as a nonexistent UUID.

The worker uses two non-superuser roles. A narrow dispatcher can inspect and lease queue lifecycle rows across owners but cannot read provider connections, credentials, raw source records, canonical facts, scoring data, ledgers, analysis audit rows, or authentication tables. A separate worker-data connection establishes the persisted owner before decrypting provider credentials or writing provider provenance and canonical data. V109 contains migration-time privilege assertions for this split; V110 keeps `analysis_runs` app-only and append-only.

Credential ciphertext, nonces, authentication tags, key identifiers, access/refresh tokens, provider raw payloads, and provider-account identifiers are excluded from public API and export contracts. Disconnect attempts provider revocation, removes local credentials even when the remote provider is unavailable, and cancels queued or running sync work cooperatively.

Analysis audit rows store a question digest, bounded date/range input summary, citation keys, generator metadata, outcome, and data-quality status. They do not store raw questions, generated answers, canonical facts, notes, source payloads, or account profile data.

## Workbook and provider ingestion

After sign-in, open **Imports**, select `my_sport` or `run_db`, choose one `.xlsx` file, and queue it. The API validates the extension, MIME signal, ZIP signature, workbook readability, filename, and 20 MB limit. Source bytes are stored outside Postgres; the request returns HTTP `202`, and the independent worker performs the import.

Open **Providers** to connect Strava. An initial backfill or incremental sync runs through `provider_sync_jobs`. The worker refreshes near-expiry credentials, requests bounded pages until an empty page, persists each raw activity in `source_records`, and only then normalizes supported fields. Rate-limit responses are durably rescheduled without consuming the retry budget. A six-hour overlap around the high-watermark allows updated activities to converge after retries or provider delays.

Provider activities use provider-native identity first. For an activity not previously linked, SportOS may link one exact canonical candidate matching type, start instant, distance, and moving time; the existing workbook/manual canonical row and provenance remain unchanged. No candidate creates a new provider canonical fact. Multiple exact candidates are retained as raw source with a `POTENTIAL_DUPLICATE` warning rather than guessed. Unsupported activity types are also retained as warning-bearing raw source records.

Daily Log, Run Lab, Rules Studio, Analysis, provider jobs, import history, provenance, and exports are scoped to the signed-in account. Angular never calculates authoritative scores or bypasses the API's owner context.

The local CLI remains available for the fixed legacy account:

```bash
pnpm import:local -- \
  --mySport=/absolute/path/to/my_sport.xlsx \
  --runDb=/absolute/path/to/running-performance.xlsx
```

## Read-only analysis

The Analysis panel executes one of two fixed tools: a bounded daily range or one persisted score breakdown. Tool results contain deterministic facts, calculations, data-quality flags, and citation keys for canonical dates, activities, score-ledger rows, immutable rule versions, source records, and import batches.

Generated guidance is returned in separate `observations`, `uncertainty`, and `suggestions` sections. Observations must cite evidence returned by the tool. Unknown citations, unsupported fields, invalid JSON, oversized output, model errors, and timeouts fall back to deterministic local guidance. Requests to edit authoritative data are refused before tool or model execution. Medical or recovery questions receive explicit uncertainty rather than a diagnosis.

The generation boundary excludes imported narrative and private source metadata, including notes, filenames, sheet names, row/upload hashes, rule names/descriptions, and rule-name-derived ledger reason text. External generation is disabled unless explicitly configured.

## Canonical export

The canonical export endpoint downloads `sportos.canonical-export.v1` JSON for a required inclusive range of at most 3,660 days. One repeatable-read transaction assembles account-owned daily summaries, activities, performance events, reconciliation, and explicit provenance. Raw cells, provider payloads, formulas, upload hashes, object keys, paths, account IDs, authentication data, credential envelopes, tokens, source bytes, generated analysis, and analysis prompts are excluded.

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

POST /analysis/tools/execute
POST /analysis/answers

GET  /imports?limit=20&offset=0
GET  /imports/:batchId?diagnosticLimit=100&diagnosticOffset=0
POST /imports/upload
GET  /imports/jobs/:jobId
POST /imports/jobs/:jobId/retry
POST /imports/jobs/:jobId/cancel
POST /imports/local-files

GET  /providers/connections
POST /providers/strava/connect
GET  /providers/strava/callback
POST /providers/connections/:connectionId/sync
GET  /providers/connections/:connectionId/jobs?limit=20
POST /providers/connections/:connectionId/disconnect
GET  /providers/jobs/:jobId
POST /providers/jobs/:jobId/retry
POST /providers/jobs/:jobId/cancel

GET  /rules
POST /rules/preview
POST /rules/activate
GET  /rules/changes?limit=50
GET  /rules/changes/:changeId
POST /rules/changes/:changeId/retry
POST /rules/changes/:changeId/cancel
```

All unsafe authenticated routes require `X-SportOS-CSRF`. Real dates, ordered ranges, maximum spans, positive distances, limits, UUIDs, analysis question length, and exact tool fields are validated before repository execution.

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
SPORTOS_OWNER_TEST_DATABASE_URL=postgres://sportos_app:sportos_app@localhost:5432/sportos_test \
  pnpm --filter @sportos/api exec vitest run src/analysis/analysis.integration.test.ts --no-file-parallelism
SPORTOS_TEST_DATABASE_URL=postgres://sportos_worker:sportos_worker@localhost:5432/sportos_test \
SPORTOS_WORKER_DATA_DATABASE_URL=postgres://sportos_worker_data:sportos_worker_data@localhost:5432/sportos_test \
  pnpm --filter @sportos/worker test:integration
SPORTOS_TEST_DATABASE_URL=postgres://sportos_legacy:sportos_legacy@localhost:5432/sportos_test \
  pnpm --filter @sportos/importers test:integration
```

The suites cover migrations through V110, populated ownership upgrade, owner isolation, immutable ownership, cross-user negative cases, legacy identity claim, import/rule/provider job dispatch, denied dispatcher access to provider credentials, analysis audits, and canonical data, owner-scoped worker execution, rotating provider credentials, pagination and empty-page termination, raw provider provenance, idempotent repeated delivery, workbook/provider overlap, transactional imports, exact ledger UUIDs, canonical export privacy/provenance, read-only analysis evaluations and cross-account evidence, API session/CSRF validation, cockpit states, and production builds.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before changing authentication, ownership, imports, providers, jobs, scoring rules, migrations, read models, analysis, or exports.
