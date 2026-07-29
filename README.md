# SportOS

SportOS is a personal sports-data cockpit that turns spreadsheet-based training records into an auditable application model.

The repository is currently an **MVP-0 implementation scaffold**, not a production-ready product. Its immediate purpose is to prove a trustworthy pipeline from source workbooks to canonical data, deterministic scores, and review screens.

## What is being built

SportOS is intended to provide one place to:

1. import historical sports data without losing the original row or its provenance;
2. normalize inconsistent spreadsheet structures into canonical activities, daily metrics, and performance events;
3. calculate official scores from versioned, deterministic rules;
4. explain how every score was produced;
5. review daily training and running performance in a web UI;
6. add integrations and read-only AI analysis only after the underlying facts are reliable.

The important design constraint is that an LLM must never invent or silently alter official points. Scoring remains deterministic application logic backed by persisted rules and a score ledger.

## Current status

The source tree contains the first vertical slice:

- Postgres schema and Flyway migrations;
- raw import-batch and source-record provenance;
- canonical activity, daily-metric, scoring, and performance tables;
- XLSX importers for the known daily and running workbooks;
- deterministic synthetic workbook fixtures;
- transactional canonical import orchestration and cross-batch source identities;
- deterministic TypeScript scoring helpers;
- a NestJS API;
- an Angular review shell with Daily Log, Run Lab, and local import controls;
- a local CLI importer.

Several pieces remain incomplete or not operationally proven. MVP-0 is complete only when the import and score-comparison workflow can be run repeatedly and differences from the spreadsheets are explainable. See [MVP-0 status](docs/FIRST_MILESTONE.md) and the [roadmap](docs/ROADMAP.md).

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
  domain/     sport types, scoring, and performance logic
  db/         Kysely schema and repositories
  importers/  XLSX extraction and normalization
  analytics/  pure analytics helpers
flyway/sql/   versioned database migrations
docs/         architecture, workbook mapping, status, and roadmap
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

Workbook assumptions and conservative mappings are documented in [docs/SPREADSHEET_MAPPING.md](docs/SPREADSHEET_MAPPING.md). Unknown sheets or columns should produce warnings rather than guessed canonical facts.

## API surface

```text
GET  /health
GET  /daily/summary?limit=365
GET  /performance/best?distanceM=5000&limit=50
POST /imports/local-files
```

`POST /imports/local-files` accepts local filesystem paths and is not an upload endpoint.

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

The integration suite generates synthetic XLSX files, imports each workbook repeatedly, verifies stable canonical row counts and IDs, injects failures at every transaction phase, checks rollback behavior, and verifies retry convergence. A skipped or green unit-test run alone does not prove database import behavior.

## Current workbook assumptions

### Daily ledger

The importer reads `Sheet1` from `my_sport.xlsx` and maps known columns such as `Date`, `Steps`, running, cycling, swimming, workout, and spreadsheet total fields. The imported spreadsheet `All` value is retained beside the app-computed total so coefficient differences remain visible.

### Running performance workbook

Known sheets are mapped conservatively to 5 km, 10 km, 12 km, half-marathon, and marathon distances. Column A is interpreted as an Excel time fraction and column B as the event date. Treadmill and starred markers are retained. Sheets with unclear semantics are skipped until confirmed.

The complete mapping belongs in [docs/SPREADSHEET_MAPPING.md](docs/SPREADSHEET_MAPPING.md), not in importer folklore.

## Near-term plan

The next cohesive product increment is score reconciliation:

1. expose score-ledger detail for one date;
2. show app total versus imported spreadsheet total;
3. explain every delta using source rows and scoring rules;
4. add import-history and row-level diagnostics;
5. verify scoring coefficients against fixture-backed spreadsheet totals.

After that, the project can move to browser uploads, asynchronous import jobs, import history, and a Rules Studio. See [docs/ROADMAP.md](docs/ROADMAP.md) for milestone exit criteria and proposed PR sequencing.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing imports, scoring rules, migrations, or generated artifacts.
