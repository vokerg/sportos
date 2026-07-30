# SportOS

SportOS is a personal sports-data cockpit that turns spreadsheet-based training records into an auditable application model.

The repository is currently a local-first implementation, not a production-ready hosted product. Its immediate purpose is to prove a trustworthy pipeline from source workbooks to canonical data, deterministic scores, and review screens.

## What is being built

SportOS is intended to provide one place to:

1. import historical sports data without losing the original row or its provenance;
2. normalize inconsistent spreadsheet structures into canonical activities, daily metrics, and performance events;
3. calculate official scores from versioned, deterministic rules;
4. explain how every score was produced and why it differs from a spreadsheet total;
5. review daily training and running performance in a web UI;
6. add integrations and read-only AI analysis only after the underlying facts are reliable.

The important design constraint is that an LLM must never invent or silently alter official points. Scoring remains deterministic application logic backed by persisted rules and a score ledger.

## Current status

The source tree contains the trustworthy MVP-0 vertical slice:

- Postgres schema and append-only Flyway migrations;
- raw import-batch and source-record provenance;
- canonical activity, daily-metric, scoring, and performance tables;
- XLSX importers for the known daily and running workbooks;
- deterministic synthetic workbook fixtures;
- transactional, idempotent canonical import orchestration;
- durable import history, status transitions, affected dates, and structured diagnostics;
- deterministic TypeScript scoring and reconciliation helpers;
- explicit rule units, rounding, thresholds, effective dates, priorities, and base/bonus classification;
- machine-readable exact, explained, unresolved, and non-comparable reconciliation evidence;
- a persisted daily score-breakdown API contract;
- a NestJS API;
- an Angular review shell with Daily Log, Run Lab, import history, and local import controls;
- a local CLI importer.

Several pieces remain unsuitable for hosted or non-developer operation. See [MVP-0 status](docs/FIRST_MILESTONE.md), [scoring semantics](docs/SCORING_RULES.md), [workbook mapping](docs/SPREADSHEET_MAPPING.md), and the [roadmap](docs/ROADMAP.md).

## Explicitly out of scope for MVP-0

- authentication and multiple users;
- browser-based uploads and durable background jobs;
- Strava, Garmin, Google Sheets, or FIT synchronization;
- editable scoring-rule UI;
- advanced dashboards;
- XLSX export;
- AI analysis.

## Architecture

```text
source workbooks
      |
      v
raw import batches and source records
      |
      v
canonical activities, daily metrics, and performance events
      |
      v
deterministic scoring rules and score ledger
      |
      v
read-model views -> NestJS API -> Angular review UI
```

Repository layout:

```text
apps/
  api/        NestJS HTTP API
  web/        Angular review application
  worker/     local CLI importer
packages/
  shared/     schemas, dates, and hash helpers
  domain/     sport types, scoring, reconciliation, and performance logic
  db/         Kysely schema and repositories
  importers/  XLSX extraction and normalization
  analytics/  pure analytics helpers
flyway/sql/   versioned database migrations
docs/         architecture, workbook mapping, scoring, evidence, status, and roadmap
```

More detail is available in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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

## Importing local workbooks

The current import flow reads files from paths visible to the API or worker process. It is suitable for local development only.

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

Workbook assumptions and conservative mappings are documented in [docs/SPREADSHEET_MAPPING.md](docs/SPREADSHEET_MAPPING.md). Unknown sheets or columns produce warnings rather than guessed canonical facts.

## Scoring and reconciliation

Enabled scoring rules are persisted in Postgres and evaluated in `packages/domain`. The current semantic contract is documented in [docs/SCORING_RULES.md](docs/SCORING_RULES.md).

Key policies:

- coefficient/manual rules round once per rule to the nearest integer;
- achievement thresholds evaluate one canonical activity, never a synthetic daily aggregate;
- rule effective-date boundaries are inclusive;
- achievement rules and `power_bonus` rules are bonus contributions;
- default spreadsheet reconciliation tolerance is zero;
- a nonzero tolerance is permitted only when an explicit lossy source rounding unit is supplied;
- unknown coefficient history and unmapped workbook components remain unresolved rather than tuned to fit totals.

The sanitized fixture report at [docs/evidence/scoring-reconciliation.fixture.json](docs/evidence/scoring-reconciliation.fixture.json) is machine-readable and verified by the test suite. It groups dates by reconciliation status, delta magnitude, activity type, and evidence-backed likely rule.

## API surface

```text
GET  /health
GET  /daily/summary?limit=365
GET  /daily/:date/score-breakdown
GET  /performance/best?distanceM=5000&limit=50
GET  /imports?limit=20&offset=0
GET  /imports/:batchId?diagnosticLimit=100&diagnosticOffset=0
POST /imports/local-files
```

`POST /imports/local-files` accepts local filesystem paths and is not an upload endpoint.

### Import history and diagnostics

`GET /imports` returns recent import batches ordered newest first. `limit` is bounded to 1–100 and `offset` to 0–10,000. Each item contains status, timing, row/normalized/warning/error counts, affected dates, and a failure summary when applicable.

`GET /imports/:batchId` returns one batch's status timeline and a bounded diagnostic page. `diagnosticLimit` is bounded to 1–250 and `diagnosticOffset` to 0–50,000. Diagnostics identify severity, code, import phase, workbook sheet, row number, and message when that context is available.

History and detail responses deliberately omit original hashes, raw cell payloads, and directory paths. Filenames are reduced to a basename. The local web form obscures paths while entered, clears them after each request, and never renders backend exception text that could contain a path.

Retention/display rules for local MVP-0:

- raw source rows remain in `source_records` for provenance and deterministic reprocessing;
- raw row payloads are not returned by import-history endpoints or displayed in the web history panel;
- structured warnings/errors may be retained in batch metadata and source-record diagnostic arrays for the life of the local database;
- no automatic pruning is performed until a future retention policy can preserve referential integrity and audit requirements;
- deleting local database data is an explicit operator action, not a UI side effect.

Malformed pagination or batch identifiers return HTTP `400` with stable error codes. A valid unknown batch identifier returns HTTP `404` with code `IMPORT_BATCH_NOT_FOUND`.

### Daily score breakdown

`GET /daily/:date/score-breakdown` reads persisted deterministic results; it does not recalculate a score. `date` must be a real ISO calendar date in `YYYY-MM-DD` format.

The response includes daily facts, app and spreadsheet totals, delta, base/bonus totals, the ledger sum, ordered ledger entries, complete persisted rule configuration, related canonical activities, and source-record/import-batch references when available.

Example, abbreviated for readability:

```json
{
  "date": "2026-05-18",
  "recomputedAt": "2026-05-18T12:00:00.000Z",
  "facts": {
    "steps": 12345,
    "runM": 13000,
    "bikeM": 35000,
    "swimM": 1000,
    "workoutPoints": 8,
    "powerPoints": 7
  },
  "score": {
    "appTotal": 55610,
    "excelTotal": 55610,
    "delta": 0,
    "baseTotal": 55603,
    "bonusTotal": 7,
    "ledgerTotal": 55610
  },
  "sourceRecord": {
    "id": "00000000-0000-4000-8000-000000000001",
    "rowHash": "...",
    "sheetName": "Sheet1",
    "rowIndex": 2,
    "batch": {
      "id": "00000000-0000-4000-8000-000000000002",
      "source": "my_sport_xlsx",
      "filename": "my_sport.xlsx",
      "originalSha256": "...",
      "status": "scored",
      "startedAt": "2026-05-18T11:59:00.000Z",
      "completedAt": "2026-05-18T12:00:00.000Z"
    }
  },
  "ledger": [
    {
      "id": "00000000-0000-4000-8000-000000000003",
      "points": 7,
      "reason": "Power/extra-effort points: round(7 points × 1) = 7",
      "calculation": {
        "ruleKind": "manual_points",
        "classification": "bonus",
        "activityType": "power_bonus",
        "metric": "effort_points",
        "metricUnit": "points",
        "metricValue": 7,
        "multiplier": 1,
        "rawPoints": 7,
        "rounding": "nearest_integer_per_rule",
        "roundedPoints": 7,
        "validFrom": "1900-01-01",
        "validTo": null,
        "priority": 60
      },
      "createdAt": "2026-05-18T12:00:00.000Z",
      "rule": {
        "id": "00000000-0000-4000-8000-000000000004",
        "code": "power.manual",
        "name": "Power/extra-effort points",
        "activityType": "power_bonus",
        "ruleKind": "manual_points",
        "metric": "effort_points",
        "coefficient": 1,
        "thresholdOperator": null,
        "thresholdValue": null,
        "thresholdUnit": null,
        "configuredPoints": null,
        "validFrom": "1900-01-01",
        "validTo": null,
        "priority": 60,
        "enabled": true
      },
      "activity": null
    }
  ]
}
```

Invalid dates return HTTP `400` with code `INVALID_DATE`. Valid dates without a persisted daily score return HTTP `404` with code `DAILY_SCORE_NOT_FOUND`. Historical rows may have null source or rule references when they cannot be linked conservatively.

## Validation

Run the same workspace checks used by CI:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Database-backed import validation must use a disposable database whose name ends in `_test` or `-test`. The integration suite deletes import-domain rows between cases and refuses to run against the normal `sportos` database.

Create and migrate a local test database once:

```bash
pnpm db:up
docker compose exec postgres createdb -U sportos sportos_test
docker compose run --rm \
  -e FLYWAY_URL=jdbc:postgresql://postgres:5432/sportos_test \
  flyway
```

Run the integration suite:

```bash
SPORTOS_TEST_DATABASE_URL=postgres://sportos:sportos@localhost:5432/sportos_test \
  pnpm --filter @sportos/importers test:integration
```

The integration suite generates synthetic XLSX files, imports workbooks repeatedly, verifies stable canonical row counts and IDs, injects failures at transaction phases, checks rollback and retry behavior, validates import-history read models, and verifies persisted scoring totals, classifications, and activity links. A skipped or green unit-test run alone does not prove database import behavior.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing imports, scoring rules, migrations, or generated evidence.
