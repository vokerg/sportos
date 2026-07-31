# SportOS

SportOS is a local-first sports-data cockpit that turns spreadsheet training records into canonical, auditable facts and deterministic scores.

The current implementation is single-user and intended to prove trustworthy workflows before accounts, provider integrations, hosted operations, or AI analysis are added.

## Current capabilities

SportOS now provides:

- bounded browser upload for supported XLSX workbooks;
- replaceable external source-file storage and durable upload metadata;
- Postgres-authoritative import jobs with leases, progress, retry, cancellation, and stale recovery;
- an independent bounded-concurrency worker process;
- retained raw rows and source-to-canonical provenance;
- transactional and idempotent normalization of activities, daily metrics, and performance events;
- deterministic scoring with exact ledger/rule provenance;
- spreadsheet/app reconciliation and daily score breakdowns;
- import history and row-level diagnostics;
- immutable scoring-rule versions with database-enforced effective-range rules;
- read-only score-change previews with date-level and aggregate deltas;
- audited asynchronous rule activation and atomic score recomputation;
- an Angular cockpit with Daily Log, Run Lab, Imports, and Rules Studio.

The remaining P1 item is complete cockpit drill-down and canonical export work. See [MVP-0 status](docs/FIRST_MILESTONE.md), [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), and the authoritative [work queue](https://github.com/vokerg/sportos/issues/3).

## Not yet implemented

- authentication, multiple users, and owner isolation;
- Strava, Garmin, Google Sheets, or FIT synchronization;
- complete dashboards, cross-screen drill-downs, and canonical export;
- hosted storage lifecycle, backup, and user-deletion workflows;
- AI analysis.

## Architecture

```text
browser XLSX / local CLI
          |
          v
upload storage + uploaded_files
          |
          v
import_jobs --------------------+
          |                      |
          v                      |
independent worker <--- scoring_rule_changes
          |                      |
          v                      |
import_batches + source_records  |
          |                      |
          v                      |
activities + daily_metrics ------+
          |
          v
scoring_rules + score_ledger
          |
          v
read models -> NestJS API -> Angular UI
```

Postgres is authoritative for job state, leases, rule versions, audit history, canonical facts, and official scores. The worker uses bounded polling and `FOR UPDATE SKIP LOCKED`; Redis is not required for correctness.

Repository layout:

```text
apps/
  api/        NestJS HTTP API
  web/        Angular local cockpit
  worker/     asynchronous jobs and local CLI
packages/
  shared/     schemas, dates, and hashes
  domain/     pure sport, scoring, preview, and reconciliation logic
  db/         Kysely schema, leases, audits, and repositories
  importers/  XLSX extraction, storage, and normalization
  analytics/  pure analytical helpers
flyway/sql/   append-only migrations
docs/         architecture, ADRs, mappings, scoring, and evidence
```

Key decisions:

- [ADR 0001](docs/adr/0001-import-transactions-and-identity.md) — import transactions and identity;
- [ADR 0002](docs/adr/0002-upload-storage-and-retention.md) — uploaded-file storage and retention;
- [ADR 0003](docs/adr/0003-import-job-lifecycle.md) — durable import jobs;
- [ADR 0004](docs/adr/0004-rule-versioning-and-recomputation.md) — immutable rule versions, preview, audit, and recomputation.

## Prerequisites

- Node.js 22
- pnpm 9.12.0
- Docker with Docker Compose

Use pnpm exclusively. Do not create npm or Yarn lockfiles.

## Local setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
```

Start the API, web application, and worker in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
pnpm dev:worker
```

Open `http://localhost:4200`.

Worker defaults:

- `IMPORT_WORKER_CONCURRENCY=1`, bounded to 1–4 import lanes;
- one additional rule-change lane;
- `IMPORT_JOB_LEASE_SECONDS=60`, bounded to 15–600;
- `IMPORT_JOB_POLL_MS=1000`, bounded to 100–60,000.

`SPORTOS_UPLOAD_DIR` defaults to `./data/uploads`. Uploaded bytes are stored beneath that directory with opaque object keys and mode-`0600` files.

Stop local services with:

```bash
pnpm db:down
```

## Workbook imports

Open **Imports**, choose `my_sport` or `run_db`, select one `.xlsx` file, and choose **Upload and queue**.

The API validates the extension, MIME signal, ZIP signature, workbook readability, filename, and 20 MB size limit. It stores the source bytes, inserts safe metadata, creates a durable job, and returns HTTP `202` without executing the importer in the request process.

The browser then displays worker phase/progress, attempts, cancellation, retry, and the linked import batch. Polling stops at a terminal state, component destruction, or 120 checks.

The queue accepts 25 active import jobs by default. Duplicate workbooks return `409 DUPLICATE_UPLOAD`; saturation returns `503 IMPORT_QUEUE_FULL`.

Queued cancellation is immediate. Running cancellation is cooperative at importer transaction boundaries. Expired leases are requeued while attempts remain, cancelled when cancellation was requested, or failed after the final attempt.

### Development-only local import

```bash
pnpm import:local -- \
  --mySport=/absolute/path/to/my_sport.xlsx \
  --runDb=/absolute/path/to/running-performance.xlsx
```

Local paths are never part of the browser contract or public history responses.

## Rules Studio

Rules Studio lists active, pending, and historical rule UUIDs. A user may create a new rule family or supersede an enabled version.

The workflow is:

1. Select or define a rule proposal.
2. Configure activity type, rule kind, metric, coefficient or achievement threshold, priority, and inclusive effective dates.
3. Request a server-side preview.
4. Review current/proposed totals and deltas for each persisted date plus the aggregate change.
5. Enter an audit reason and confirm the exact preview fingerprint.
6. Monitor the durable rule-change job.
7. Review the terminal audit record and immutable versions.

Preview is read-only and bounded to 5,000 persisted dates. It never changes official totals or ledger rows.

Activation inserts the proposed UUID disabled and queues one audited job. The worker then performs one transaction that closes the superseded range when required, enables the new UUID, recomputes affected daily totals, replaces ledger rows, and marks the audit successful. Any failure rolls that whole transaction back, leaving the prior rule and authoritative scores unchanged. Failed jobs can be retried with the same audit identity while attempts remain.

Enabled ranges for one family cannot overlap, including shared inclusive boundary dates. The database enforces this policy in addition to API validation. Existing ledger entries continue to identify the exact rule UUID used for their score contribution.

## Source retention and privacy

For the local milestone, uploaded files, raw source records, job state, and audit history are retained indefinitely by default.

- workbook bytes remain outside Postgres;
- API responses omit storage keys, local paths, and raw source bytes;
- filenames are reduced to safe basenames;
- failures are redacted before persistence or display;
- source deletion is an explicit coordinated operator action.

Hosted use requires authentication, owner scoping, encryption, backup, lifecycle policy, and audited deletion.

## Scoring semantics

Enabled rules are evaluated in `packages/domain`; Angular never calculates authoritative points.

Key policies:

- coefficient/manual rules round once per rule to the nearest integer;
- achievements evaluate one canonical activity, not a synthetic daily aggregate;
- effective-date boundaries are inclusive;
- achievement and `power_bonus` contributions are bonuses;
- rule changes create new UUIDs instead of silently mutating historical meaning;
- default spreadsheet reconciliation tolerance is zero;
- unresolved source semantics remain unresolved rather than being tuned to fit totals.

See [SCORING_RULES.md](docs/SCORING_RULES.md) and the verified [reconciliation fixture](docs/evidence/scoring-reconciliation.fixture.json).

## API surface

```text
GET  /health
GET  /daily/summary?limit=365
GET  /daily/:date/score-breakdown
GET  /performance/best?distanceM=5000&limit=50

GET  /imports?limit=20&offset=0
GET  /imports/:batchId?diagnosticLimit=100&diagnosticOffset=0
POST /imports/upload
GET  /imports/jobs/:jobId
POST /imports/jobs/:jobId/retry
POST /imports/jobs/:jobId/cancel
POST /imports/local-files                     development-only

GET  /rules
POST /rules/preview
POST /rules/activate
GET  /rules/changes?limit=50
GET  /rules/changes/:changeId
POST /rules/changes/:changeId/retry
POST /rules/changes/:changeId/cancel
```

Rule proposal validation returns `400 INVALID_RULE_PROPOSAL` with field-level issues. Stale fingerprints, overlaps, active family changes, and invalid lifecycle transitions return stable `409` contracts. Unknown valid UUIDs return `404`.

## Validation

Run the root gates used by CI:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Database-backed suites require a disposable database whose name ends in `_test` or `-test`:

```bash
pnpm db:up
docker compose exec postgres createdb -U sportos sportos_test
docker compose run --rm \
  -e FLYWAY_URL=jdbc:postgresql://postgres:5432/sportos_test \
  flyway

SPORTOS_TEST_DATABASE_URL=postgres://sportos:sportos@localhost:5432/sportos_test \
  pnpm --filter @sportos/db test:integration
SPORTOS_TEST_DATABASE_URL=postgres://sportos:sportos@localhost:5432/sportos_test \
  pnpm --filter @sportos/worker test:integration
SPORTOS_TEST_DATABASE_URL=postgres://sportos:sportos@localhost:5432/sportos_test \
  pnpm --filter @sportos/importers test:integration
```

The suites cover import and rule-job claims, queue limits, monotonic progress, cancellation, retries, stale recovery, independent worker execution, transactional imports, overlap rejection, atomic rule activation/recomputation, exact ledger UUIDs, API contracts, browser polling, and production builds.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before changing imports, jobs, scoring rules, migrations, or generated evidence.
