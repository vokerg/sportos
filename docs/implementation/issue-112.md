# Issue 112: provider activity metrics

Status: implementation in draft PR #113; no merge authorized.

Maintainer explicitly selected #112. Main/origin main were identical at
`3ea765982feba61d8f991270bcb340ba052ba7e4`; no open PRs or competing claims.
Claim: `issue-112-provider-metrics`.

Exit criterion: independent versioned provider metrics and processing coverage,
source-selected read comparison, retained-only resumable backfill, without changes
to canonical activity authority, scoring, ledger, snapshots or Run Lab.

## Investigation before implementation

Inspected: AGENTS.md; README.md; docs/ARCHITECTURE.md; docs/ROADMAP.md;
docs/AUTHENTICATION.md; docs/AI_ANALYSIS.md; docs/FRONTEND_ARCHITECTURE.md;
docs/ACTIVITIES.md; ADRs 0001, 0006, 0010; issue #112 and queue #3 and its claims;
all primary Flyway migrations (schema/function/grant inventory), in detail V124,
V126, and detail resource migrations; root and domain/db/API package manifests;
packages/domain/src/index.ts; packages/db/src/schema.ts and garmin-activity-schema.ts;
repositories activities, Garmin identities/resources/strength, Strava resources;
activity repository integration tests; API activities controller, enrichment,
provider-detail, Garmin local ingestion/review, app.module and db.provider;
provider-detail tests; web Activities list/detail pages, presenter, API client,
provider view models and activity-detail store; local strength projection script;
tools/garmin/extract_activity.py and synthetic extractor fixtures.

Documentation mismatches: #101 list badges remain described as follow-up; #112
owns those additions. Roadmap still calls #111 draft although main includes its
walking migration and there are no open PRs. Historical version status in auth/AI
docs predates current V128; avoid unrelated documentation rewrites.

Mapping evidence: official Strava DetailedActivity reference and Garmin FIT SDK
session profile. Unknown units/developer fields remain raw; primary projection
contains scalar metrics only. No real provider fixture is committed.

## Scope coordination

Issue #100 remains the detailed exercise/time-series work; #108 is closed.
This change reuses its immutable strength summaries and preserves resource JSON.
No detailed set model, time-series persistence, daily health or best effort is added.

## Implementation

- V129 and synchronized Kysely types: immutable bounded projection versions and
  scalar observations, one current checkpoint per provider, RLS/grant assertions,
  owner/source/version membership checks, and safe historical canonical deletion.
- Declarative parser/catalog and deterministic source-priority read comparison.
  Core fields retain current authority; disagreements remain independent.
- Explicit post-retention/cache-reuse projection, local commit/manual-link hooks,
  protected retained-only reprocessing; navigation remains read-only.
- Lightweight list/detail status and provider comparison/provenance components;
  feature store owns request replacement and refreshes after explicit actions.
- Operator retained-only backfill: default dry-run, deterministic bounded UUID
  cursor, retry, safe error categories and no advancement on failed batches.
- See ACTIVITY_METRICS.md for source units, precedence and operator instructions.

## Validation

Passed on the final source:

- Catalog parser tests: 7.
- Focused API/controller/cache/helper regressions and Garmin day service: 35.
- Activities UI/state/model tests: 23.
- Non-owner primary/detail repository and backfill plus existing Garmin/resource/
  canonical Activities regressions: 25 (including worker-data scope and dispatcher
  denial), on disposable isolated PostgreSQL 16 databases. No integration skipped.
- Fresh Flyway through V129 (38 primary migrations) and separate detail through
  V003; populated V128→V129 upgrade and the committed official-row verifier.
- Real operator CLI against synthetic retained fixtures: dry run, apply and
  repeated apply. Replay projected zero new versions with stable results and
  `fetched:false`, `scoreWrites:false`.
- Root `pnpm typecheck`, production web build and `git diff --check`.

No live migration, personal-data backfill, provider download, full repository
matrix, hosted/Neon validation or browser visual inspection was performed.
Migration checks used disposable PostgreSQL, not the maintained Neon projects.
CI still skips tests requiring detail database secrets when unconfigured; the
focused primary/detail suite above ran explicitly with all non-owner identities.
The draft PR is not merged, and the issue/queue are not marked complete.

## Additional inspected files during implementation/validation

- scripts/flyway.mjs; .github/workflows/ci.yml; .gitignore;
- packages/db/src/pool.ts, ownership-context.ts;
- packages/db/src/repositories/providers.repository.ts;
- activity-provider-resources, Garmin identities/resources integration tests;
- apps/api/src/activities/activities.controller.test.ts,
  activity-enrichment.service.test.ts, activity-enrichment.integration.test.ts;
- apps/web Activities page/state/view-model tests;
- tsconfig.base.json and packages/db/tsconfig.json;
- official Strava reference and Garmin FIT SDK profile (mapping definitions only);
- issue #100 scope and #108 completion state.

Review found and fixed NUMERIC serialization for core selections, canonical
history deletion compatibility, failed-batch cursor advancement and timestamp
precision for concurrent projections. Unknown rich fields remain in raw retention.
