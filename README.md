# SportOS

SportOS is a personal sports-data cockpit that turns spreadsheet-based training records into an auditable application model.

The repository is a local-first single-user implementation, not a production-ready hosted product. Its immediate purpose is to prove a trustworthy workflow from source workbooks to canonical data, deterministic scores, and review screens.

## What is being built

SportOS is intended to provide one place to:

1. import historical sports data without losing the original file, row, or provenance;
2. normalize inconsistent spreadsheet structures into canonical activities, daily metrics, and performance events;
3. calculate official scores from versioned, deterministic rules;
4. explain how every score was produced and why it differs from a spreadsheet total;
5. review daily training, imports, and running performance in a web UI;
6. add accounts, integrations, and read-only AI analysis only after the underlying facts are reliable.

The important design constraint is that an LLM must never invent or silently alter official points. Scoring remains deterministic application logic backed by persisted rules and a score ledger.

## Current status

The source tree contains:

- Postgres schema and append-only Flyway migrations;
- external source-file storage plus durable upload metadata;
- bounded browser upload for supported XLSX workbooks;
- raw import-batch and source-record provenance;
- canonical activity, daily-metric, scoring, and performance tables;
- transactional, idempotent import orchestration;
- durable import history, status transitions, affected dates, and structured diagnostics;
- deterministic scoring and reconciliation helpers;
- explicit rule units, rounding, thresholds, effective dates, priorities, and base/bonus classification;
- machine-readable exact, explained, unresolved, and non-comparable reconciliation evidence;
- a persisted daily score-breakdown API;
- an Angular local cockpit with Daily Log, Run Lab, browser upload, import history, and diagnostics;
- a local CLI importer for development and operator use.

The remaining P1 work is asynchronous import jobs, Rules Studio, and complete cockpit/export workflows. See [MVP-0 status](docs/FIRST_MILESTONE.md), [scoring semantics](docs/SCORING_RULES.md), [workbook mapping](docs/SPREADSHEET_MAPPING.md), and the [roadmap](docs/ROADMAP.md).

## Not yet implemented

- authentication and multiple users;
- durable background import jobs and cancellation;
- Strava, Garmin, Google Sheets, or FIT synchronization;
- editable scoring-rule UI and audited recomputation;
- complete dashboards and canonical export;
- hosted storage lifecycle, backups, and user deletion workflows;
- AI analysis.

## Architecture

```text
browser XLSX / local CLI
          |
          v
upload storage + uploaded_files
          |
          v
import_batches + source_records
          |
          v
activities + daily_metrics + performance_events
          |
          v
scoring_rules + score_ledger
          |
          v
read models -> NestJS API -> Angular UI
```

Repository layout:

```text
apps/
  api/        NestJS HTTP API and local storage adapter
  web/        Angular local cockpit
  worker/     local CLI importer
packages/
  shared/     schemas, dates, and hash helpers
  domain/     sport types, scoring, reconciliation, and performance logic
  db/         Kysely schema and repositories
  importers/  XLSX extraction and normalization
  analytics/  pure analytics helpers
flyway/sql/   versioned database migrations
docs/         architecture, ADRs, mappings, scoring, evidence, status, and roadmap
```

More detail is available in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Upload storage and retention are defined in [ADR 0002](docs/adr/0002-upload-storage-and-retention.md).

## Prerequisites

- Node.js 22
- pnpm 9.12.0
- Docker with Docker Compose

Use pnpm for this repository. Do not create or commit npm or Yarn lockfiles.

## Local setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
```

`SPORTOS_UPLOAD_DIR` defaults to `./data/uploads`. Uploaded files are written beneath that directory with opaque object keys and are ignored by Git.

Start the API and web application in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
```

Open `http://localhost:4200`.

To stop the local services:

```bash
pnpm db:down
```

## Uploading workbooks in the browser

Open the **Imports** panel, choose the workbook type, select an `.xlsx` file, and choose **Upload and import**.

The browser workflow:

- accepts one workbook per request;
- limits uploads to 20 MB;
- validates extension, MIME signal, ZIP signature, and workbook readability;
- sanitizes the display filename;
- shows upload progress and actionable validation errors;
- fingerprints the file with SHA-256 and returns `409 DUPLICATE_UPLOAD` for an identical non-deleted workbook of the same type;
- stores workbook bytes outside Postgres and persists only metadata, provenance, raw rows, and canonical facts in Postgres;
- never returns the storage root, object path, or server-local filesystem path.

Supported workbook types are:

- `my_sport` — daily ledger workbook;
- `run_db` — running performance workbook.

Unknown sheets or columns produce warnings rather than guessed facts. Workbook assumptions are documented in [docs/SPREADSHEET_MAPPING.md](docs/SPREADSHEET_MAPPING.md).

### Development-only local path import

The CLI and `POST /imports/local-files` remain available for local development and operator workflows:

```bash
pnpm import:local -- \
  --mySport=/absolute/path/to/my_sport.xlsx \
  --runDb=/absolute/path/to/running-performance.xlsx
```

Equivalent worker command:

```bash
pnpm --filter @sportos/worker import:local -- \
  --mySport=/absolute/path/to/my_sport.xlsx \
  --runDb=/absolute/path/to/running-performance.xlsx
```

The Angular application does not ask for or submit filesystem paths.

## Source-file retention and privacy

For the local single-user milestone, uploaded files and metadata are retained indefinitely by default so imports can be audited and reprocessed. There is no automatic pruning or browser deletion action.

- uploaded bytes are stored under `SPORTOS_UPLOAD_DIR`, not in Postgres;
- raw source rows remain in `source_records`;
- API history/detail responses omit storage object keys, server paths, raw cell payloads, and original hashes;
- filenames are reduced to safe basenames;
- failures are redacted before persistence or display;
- deleting source files is an explicit coordinated operator action, not a side effect of import failure, duplication, or history cleanup.

Hosted use requires owner scoping, encrypted object storage, backups, lifecycle policy, and an audited deletion workflow before this retention policy changes.

## Scoring and reconciliation

Enabled scoring rules are persisted in Postgres and evaluated in `packages/domain`. The semantic contract is documented in [docs/SCORING_RULES.md](docs/SCORING_RULES.md).

Key policies:

- coefficient/manual rules round once per rule to the nearest integer;
- achievement thresholds evaluate one canonical activity, never a synthetic daily aggregate;
- rule effective-date boundaries are inclusive;
- achievement rules and `power_bonus` rules are bonus contributions;
- default spreadsheet reconciliation tolerance is zero;
- a nonzero tolerance is permitted only when an explicit lossy source rounding unit is supplied;
- unknown coefficient history and unmapped workbook components remain unresolved rather than tuned to fit totals.

The sanitized fixture report at [docs/evidence/scoring-reconciliation.fixture.json](docs/evidence/scoring-reconciliation.fixture.json) is machine-readable and verified by the test suite.

## API surface

```text
GET  /health
GET  /daily/summary?limit=365
GET  /daily/:date/score-breakdown
GET  /performance/best?distanceM=5000&limit=50
GET  /imports?limit=20&offset=0
GET  /imports/:batchId?diagnosticLimit=100&diagnosticOffset=0
POST /imports/upload
POST /imports/local-files        development-only
```

### Workbook upload

`POST /imports/upload` accepts `multipart/form-data` with:

- `file`: one XLSX workbook;
- `workbookKind`: `my_sport` or `run_db`.

Validation failures return HTTP `400` with stable codes such as `UNSUPPORTED_FILE_EXTENSION`, `UNSUPPORTED_MEDIA_TYPE`, `UPLOAD_TOO_LARGE`, or `INVALID_XLSX`. A known duplicate returns HTTP `409` with `DUPLICATE_UPLOAD` and a privacy-safe reference to the existing upload/batch. Storage and import failures return stable, path-free error contracts.

A successful response includes the safe upload metadata, import batches, normalized counts, and warnings. It never includes a storage object key or local path.

### Import history and diagnostics

`GET /imports` returns recent import batches ordered newest first. `limit` is bounded to 1–100 and `offset` to 0–10,000. Each item contains status, timing, row/normalized/warning/error counts, affected dates, and a failure summary when applicable.

`GET /imports/:batchId` returns one batch's status timeline and a bounded diagnostic page. `diagnosticLimit` is bounded to 1–250 and `diagnosticOffset` to 0–50,000.

Malformed pagination or batch identifiers return HTTP `400` with stable error codes. A valid unknown batch identifier returns HTTP `404` with `IMPORT_BATCH_NOT_FOUND`.

### Daily score breakdown

`GET /daily/:date/score-breakdown` reads persisted deterministic results; it does not recalculate a score. The response includes daily facts, app and spreadsheet totals, delta, base/bonus totals, ordered ledger entries, complete persisted rule configuration, related activities, and source provenance.

Invalid dates return HTTP `400` with `INVALID_DATE`. Valid dates without a persisted score return HTTP `404` with `DAILY_SCORE_NOT_FOUND`.

## Validation

Run the same workspace checks used by CI:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Database-backed import validation must use a disposable database whose name ends in `_test` or `-test`:

```bash
pnpm db:up
docker compose exec postgres createdb -U sportos sportos_test
docker compose run --rm \
  -e FLYWAY_URL=jdbc:postgresql://postgres:5432/sportos_test \
  flyway

SPORTOS_TEST_DATABASE_URL=postgres://sportos:sportos@localhost:5432/sportos_test \
  pnpm --filter @sportos/importers test:integration
```

The test suite covers local storage contract behavior, traversal resistance, upload validation/error codes, real XLSX byte parsing, browser progress/duplicate guidance, transactional imports, upload-to-batch linkage, duplicate lookup, idempotency, rollback, diagnostics, and persisted scoring.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing uploads, imports, scoring rules, migrations, or generated evidence.
