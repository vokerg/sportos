# SportOS

SportOS is a local-first, account-scoped sports-data cockpit for importing training records, synchronizing provider activity, preserving source provenance, calculating deterministic scores, reviewing canonical results, and producing cited read-only analysis.

> **Project status:** the prioritized implementation roadmap is complete through issue [#16](https://github.com/vokerg/sportos/issues/16). The current schema is validated through Flyway V110, and the authoritative work queue is maintained in [issue #3](https://github.com/vokerg/sportos/issues/3).

## What SportOS can do

### Import and preserve training data

- Upload supported `my_sport` and running-performance XLSX workbooks from the browser.
- Validate file type, ZIP signature, workbook readability, filename, and a 20 MB size limit before queuing work.
- Keep uploaded bytes outside Postgres behind a replaceable storage contract.
- Process imports through durable Postgres-backed jobs with leases, progress, retries, cancellation, and stale recovery.
- Retain raw workbook rows before normalization and link them to canonical activities, daily metrics, and performance events.
- Re-import identical data transactionally and idempotently without duplicating canonical facts.
- Review import history, row-level diagnostics, warnings, and exact source provenance.

### Connect and synchronize Strava

- Connect Strava through OAuth without exposing access or refresh tokens to the browser.
- Encrypt provider credentials with versioned AES-256-GCM envelopes bound to the account, connection, provider, and envelope version.
- Run initial backfills and incremental synchronization through durable provider jobs.
- Refresh rotating credentials server-side and resume safely across pagination, retries, rate limits, cancellation, and stale leases.
- Persist bounded raw provider snapshots before normalization.
- Use provider-native identity first, then apply a conservative exact/no-match/ambiguous cross-source policy.
- Preserve existing workbook provenance when one exact Strava activity matches an existing canonical activity.
- Retain unsupported or ambiguous provider records with warnings instead of guessing or discarding them.
- Disconnect safely by attempting remote revocation, removing local credentials, and cancelling queued or running synchronization work.

### Review, score, and export canonical records

- Browse daily summaries and inspect exact score-ledger, immutable rule-version, activity, source-record, and import-batch provenance.
- Explore running performance, personal-best views, event detail, and source attribution in Run Lab.
- Preview scoring-rule changes without writes.
- Publish immutable rule versions with non-overlapping account-scoped effective ranges.
- Recompute affected scores atomically through audited background jobs.
- Reconcile persisted score totals against deterministic domain calculations.
- Export bounded, versioned `sportos.canonical-export.v1` JSON from one repeatable-read snapshot.
- Exclude raw cells, formulas, provider payloads, credentials, account identifiers, storage internals, prompts, and generated analysis from canonical exports.

### Ask cited, read-only questions

- Analyze either a bounded daily range or one persisted daily score breakdown.
- Keep totals, averages, extrema, comparisons, and official score explanations in deterministic application code.
- Return exact citation keys for canonical dates, activities, score-ledger rows, immutable rule versions, source records, and import batches.
- Separate generated observations, uncertainty, and suggestions from official SportOS evidence in both API contracts and the Angular UI.
- Reject requests to edit authoritative records before tool or generator execution.
- Add explicit uncertainty for insufficient data, conflicts, medical conclusions, recovery claims, and overtraining questions.
- Use a deterministic local fallback by default, sending no question or SportOS record outside the API process.
- Optionally call an operator-controlled HTTPS JSON generator with bounded sanitized evidence and strict citation validation.
- Store only append-only redacted audit metadata: a question digest, bounded tool input, citation identifiers, generator metadata, outcome, and data-quality status.

### Isolate every account

- Authenticate with OIDC Authorization Code + PKCE; SportOS stores no passwords.
- Map an immutable external `(issuer, subject)` identity to an internal account UUID.
- Use opaque server-side sessions with idle and absolute expiry, immediate revocation, HttpOnly cookies, and session-bound CSRF protection.
- Scope uploads, imports, jobs, providers, canonical facts, scores, rules, audits, analysis runs, performance records, and exports to the signed-in account.
- Enforce ownership with account-scoped constraints, same-owner foreign keys, immutable owner columns, and forced PostgreSQL row-level security.
- Return the same generic result for foreign and nonexistent identifiers to reduce account enumeration.
- Separate the narrow cross-account queue dispatcher from owner-scoped worker-data execution.

## Completed milestones

| Milestone | Delivered outcome |
|---|---|
| Trustworthy ingestion | Sanitized fixtures, transactional/idempotent imports, source provenance, score explanations, reconciliation, diagnostics, and documented scoring semantics |
| Usable local cockpit | Browser upload, durable import jobs, Rules Studio, audited recomputation, Daily Log, Run Lab, and canonical export |
| Accounts and integrations | OIDC sessions, per-account ownership, forced RLS, split worker authorization, encrypted provider credentials, and the first Strava adapter |
| Read-only analysis | Fixed authorized read tools, deterministic calculations, validated citations, safe generation fallback, append-only audit metadata, evaluations, and explicit generated-versus-official UI separation |

See [docs/ROADMAP.md](docs/ROADMAP.md) for milestone evidence and remaining operational gaps.

## Architecture

```text
OIDC provider -> opaque API session + CSRF
                         |
                         v
       account-bound pooled connection -> forced RLS + same-owner constraints
                         |
        +----------------+-------------------+
        |                                    |
        v                                    v
browser XLSX -> upload storage       Strava OAuth -> encrypted credentials
        |                                    |
        v                                    v
   import_jobs                       provider_sync_jobs
        |                                    |
        +---------- narrow queue dispatcher--+
                         |
                    persisted owner
                         |
                         v
              owner-scoped worker-data executor
                         |
                         v
              import_batches + source_records
                         |
          +--------------+----------------+
          |                               |
          v                               v
 activities + provider links       performance_events
          |                               |
          +---------------+---------------+
                          v
        daily_metrics + scoring_rules + score_ledger
                          |
                          v
       owner-scoped read repositories + deterministic analysis tools
                          |                         |
                          |                         v
                          |            validated generator + safe fallback
                          |                         |
                          |                         v
                          |                 analysis_runs audit
                          |                         |
                          +------------+------------+
                                       |
                                       v
                   canonical export + Angular cockpit
```

Postgres is authoritative for accounts, external identities, sessions, ownership, provider metadata, encrypted credential envelopes, synchronization cursors, job leases, audit history, provenance, canonical facts, rule versions, official scores, and analysis-run metadata. Uploaded workbook bytes remain outside Postgres. Generated guidance is non-authoritative and cannot calculate or persist official scores.

The runtime uses separate non-superuser database identities:

| Role | Responsibility |
|---|---|
| `sportos_app` | Authentication, sessions, account-scoped API work, provider authorization, and append-only analysis-audit inserts |
| `sportos_worker` | Narrow cross-account queue discovery and leasing only |
| `sportos_worker_data` | Owner-scoped import, provider-sync, and rule-recomputation execution |
| `sportos_legacy` | Fixed legacy-account local CLI and compatibility paths |
| Flyway/schema owner | Migrations only; never used by runtime processes |

For the complete invariants and data flows, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prerequisites

- Node.js 22
- pnpm 9.12.0
- Docker with Docker Compose
- an OIDC provider for normal sign-in
- optionally, a Strava API application
- optionally, an operator-controlled HTTPS JSON model endpoint

Use pnpm exclusively. Do not create npm or Yarn lockfiles.

## Quick start

```bash
git clone https://github.com/vokerg/sportos.git
cd sportos
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
```

The local Docker setup creates development-only non-superuser database roles. Existing database volumes should follow the provisioning and migration guidance in [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).

### Configure local development auth

For this single-user hobby project, local development uses the fixed legacy account directly. No OIDC provider, login page, or browser session cookie is required:

```dotenv
SPORTOS_AUTH_MODE=dev-single-user
SPORTOS_API_ORIGIN=http://localhost:3000
SPORTOS_WEB_ORIGIN=http://localhost:4200
```

### Configure OIDC for hosted or multi-user deployments

```dotenv
SPORTOS_OIDC_ISSUER=https://identity.example.com
SPORTOS_OIDC_CLIENT_ID=sportos-local
SPORTOS_OIDC_CLIENT_SECRET=
SPORTOS_API_ORIGIN=http://localhost:3000
SPORTOS_WEB_ORIGIN=http://localhost:4200
SPORTOS_COOKIE_SECURE=false
```

To let one OIDC identity claim data migrated from the former single-user installation, configure both `SPORTOS_LEGACY_OIDC_ISSUER` and `SPORTOS_LEGACY_OIDC_SUBJECT` before that identity's first login. Keep the mapping stable until the claim is verified.

`POST /auth/dev-session` is available only when `SPORTOS_DEV_AUTH_TOKEN` is explicitly configured. Keep it unset outside isolated development.

### Optional Strava configuration

Register the exact callback URL with Strava, then configure the API and worker with the same provider secrets and encryption-key ring:

```dotenv
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=http://localhost:3000/providers/strava/callback
SPORTOS_PROVIDER_CREDENTIAL_KEYS=k1=<base64-encoded-32-byte-key>
SPORTOS_PROVIDER_ACTIVE_KEY_ID=k1
```

Generate a 32-byte key outside source control, for example:

```bash
openssl rand -base64 32
```

During key rotation, add the new key, retain older keys for decryption, and change `SPORTOS_PROVIDER_ACTIVE_KEY_ID`. Removing an old key before all stored envelopes rotate forces those connections to reauthorize.

### Optional external analysis generator

Read-only analysis uses the deterministic local fallback by default. External generation is opt-in:

```dotenv
SPORTOS_AI_JSON_ENDPOINT=https://model-gateway.example.com/sportos-analysis
SPORTOS_AI_MODEL=approved-model-name
SPORTOS_AI_API_KEY=
SPORTOS_AI_TIMEOUT_MS=15000
```

HTTPS is required except for localhost development. The external endpoint receives only a bounded question, sanitized official tool output, allowed citation keys, and the read-only policy. See [docs/AI_ANALYSIS.md](docs/AI_ANALYSIS.md) for the exact request and response contract.

## Run the application

Start each process in a separate terminal:

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:worker
```

Open `http://localhost:4200` and sign in.

Stop local services with:

```bash
pnpm db:down
```

## Cockpit workflows

After authentication, the Angular cockpit provides:

- **Analysis** — cited daily-range or score-breakdown guidance, official evidence, quality flags, and audit reference.
- **Daily Log** — daily summaries, deterministic score totals, reconciliation, and exact ledger/rule/source provenance.
- **Run Lab** — performance rankings, bounded event search, event detail, and provenance.
- **Rules** — current rule versions, read-only preview, activation, recomputation progress, retry, and cancellation.
- **Providers** — Strava connection, backfill, incremental sync, status, retry, cancellation, disconnect, and provenance.
- **Imports** — browser upload, durable job status, history, diagnostics, retry, cancellation, and reconciliation handoff.
- **Export** — bounded canonical JSON export with deterministic ordering and explicit provenance.

The browser renders API truth only. It never receives provider tokens, selects an owner, normalizes canonical facts, computes official scores, or treats generated guidance as authoritative.

## Local workbook import CLI

The fixed legacy-account CLI remains available:

```bash
pnpm import:local -- \
  --mySport=/absolute/path/to/my_sport.xlsx \
  --runDb=/absolute/path/to/running-performance.xlsx
```

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
POST /imports/local-files
GET  /imports/jobs/:jobId
POST /imports/jobs/:jobId/retry
POST /imports/jobs/:jobId/cancel

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

All unsafe authenticated routes require `X-SportOS-CSRF`. The API validates real dates, ordered ranges, maximum spans, positive distances, limits, UUIDs, exact tool fields, and bounded questions before repository execution.

## Repository layout

| Path | Responsibility |
|---|---|
| `apps/api` | NestJS authentication, account context, HTTP validation, provider OAuth, reads, exports, analysis orchestration, and audit inserts |
| `apps/web` | Angular authenticated cockpit and user-safe workflow states |
| `apps/worker` | Queue dispatch plus owner-scoped import, provider, and rule workers; legacy CLI |
| `packages/domain` | Pure deterministic scoring, reconciliation, rule validation, and preview logic |
| `packages/db` | Kysely schema, account context, repositories, jobs, audits, read models, and export assembly |
| `packages/importers` | Upload storage, XLSX extraction, provider contracts, normalization, warnings, and import transactions |
| `packages/shared` | Shared schemas, serialization, real-date utilities, and export contracts |
| `packages/analytics` | Pure analytics without database dependencies |
| `flyway/sql` | Append-only schema migrations, constraints, RLS, grants, views, indexes, and privilege assertions |
| `docs` | Architecture, roadmap, operational guidance, ADRs, and evidence |

## Validation

Run the root gates used by CI:

```bash
pnpm typecheck
pnpm test
pnpm build
```

For database integration, create and migrate a disposable database whose name ends in `_test` or `-test`, then run the suites through their intended non-owner roles:

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

CI covers frozen installation, fresh migration through V110, populated ownership upgrades, account isolation, immutable ownership, split worker privileges, import/rule/provider job recovery, encrypted token refresh, raw provider provenance, idempotent delivery, workbook/provider overlap, deterministic score provenance, canonical-export privacy, read-only analysis evaluations, cross-account analysis evidence, Angular workflow states, and production builds.

## Current limitations

The completed roadmap is a strong local and account-scoped foundation, not a finished hosted service. Work not yet implemented includes:

- Garmin, Google Sheets, FIT, or additional provider synchronization;
- operational provider-webhook subscription verification and inbox processing;
- a broader cross-provider time-zone and locale policy;
- hosted object deletion, backup, restoration, and account-erasure workflows;
- managed key storage and automated credential-envelope migration;
- hosted monitoring, alerting, deployment, external rate limiting, and wake-up acceleration;
- streaming or durable hosted-scale export;
- hosted model-gateway operations, broader semantic evaluation, and additional analysis tools.

New product or operational work must be added and prioritized explicitly in [issue #3](https://github.com/vokerg/sportos/issues/3).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Authentication and ownership](docs/AUTHENTICATION.md)
- [Read-only analysis operations](docs/AI_ANALYSIS.md)
- [Canonical export v1](docs/CANONICAL_EXPORT.md)
- [First milestone evidence](docs/FIRST_MILESTONE.md)
- [Architecture decision records](docs/adr/)
- [Agent guidance](AGENTS.md)
- [Contributing](CONTRIBUTING.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before changing authentication, ownership, imports, providers, jobs, scoring rules, migrations, read models, analysis, or exports. Always use the authoritative queue in [issue #3](https://github.com/vokerg/sportos/issues/3) to select implementation work.
