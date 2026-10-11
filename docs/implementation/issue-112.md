# Issue 112: provider activity metrics

Status: validated implementation in PR #113; maintainer authorized squash merge
after the successful visual check on 2026-10-11.

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

Initial implementation validation used disposable PostgreSQL. The later Neon
validation below supersedes the original no-live-migration limitation. No provider
download, full repository matrix or browser visual inspection was performed.
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


## Neon validation follow-up (2026-10-11)

The maintainer authorized live V129 and retained-only dry-run/apply/replay, without
provider downloads or merge. Flyway validated all 38 migrations and applied only
V129, upgrading the maintained primary Neon database from V128. The new tables
were empty after migration; no implicit backfill ran. Both primary/detail runs
used non-owner `sportos_app` connections. Local detail runtime configuration was
corrected from schema-owner credentials using the existing Neon runtime URL;
no credentials were reset, and no secrets are committed.

### Real retained-history results

The complete dry run inspected 20,301 canonical activities in 204 bounded batches.
There were 8,235 linked Strava activities and 18 linked Garmin identities, with
12,066 activities requiring no provider projection. The separate Garmin inventory
had two pending/unlinked identities, which remained unlinked.

| Provider | Current projections | Processed | Partial | Stale | Failed | Missing rich data |
|---|---:|---:|---:|---:|---:|---:|
| Strava | 8,235 | 4 | 8,231 | 0 | 0 | 8,231 detail resources |
| Garmin | 18 | 18 | 0 | 0 | 0 | 0 for linked identities |

The applied run completed all 20,301 activities without errors. Its final replay
from the beginning created 7,954 Strava and 16 Garmin projections and reused 281
Strava and two Garmin projections completed before an intentional interruption.
All seven interrupted/unprocessed checkpoints converged. The resulting primary
inventory is 8,253 heads, 8,253 immutable projections and 80,608 scalar observations.
There are no inconsistent heads or stranded unprocessed states.

One compact Strava heart-rate observation was below the supported minimum and
was excluded; original raw evidence remained intact. Optional absent metrics
remain absent. Garmin running dynamics, power, Training Effect, swimming lengths
and existing strength counts projected where supported retained fields existed.
No full Garmin archive, provider login or new download was required.

An owner-scoped baseline compared complete row digests and counts before migration,
after migration, after interruption and after full apply for canonical activities,
daily metrics, ledger, score snapshots, performance events, rules, provider links,
Garmin identities and strength summaries. Every comparison was unchanged. Private
digests, cursors and operator artifacts remain outside the repository.

The API verified 21 detail activities and a 25-item list. Eighteen samples expose
both provider distances; ten retain differing source distances. All 21 retain
canonical distance/source authority. Dispatcher access to all three new tables
is denied on Neon; owner-scoped worker-data reads see 8,253 heads, while an app
read without account context sees zero.

### Backfill efficiency and validation

The real dataset exposed repeated metadata reads and reconciliation-lock round
trips in the row-at-a-time implementation. Compact metadata now batches up to
100 canonical activities. Successful retained inspections use two separately
committed bounded checkpoint/publication phases, each validating current source
membership and Postgres timestamp precision under the existing account lock.
Scalar inserts are chunked to bound SQL parameters. If bulk publication fails,
the original per-source workflow allows valid inspections to converge.

New non-owner tests cover metadata batching, 600-observation insert chunking,
unchanged replay/timestamps, committed checkpoint recovery after publication
failure, stale source membership, sub-millisecond ordering and foreign ownership.
Final focused checks passed: 7 catalog, 35 API, 23 UI and 29 database/backfill tests
(94 total), plus root typecheck and diff checks. The original production web build
and fresh/populated migration validation remain applicable; no frontend source or
migration SQL changed in this follow-up. No full repository matrix was performed. The later visual check below supersedes
the original browser-inspection limitation.

A real operator CLI dry-run passed; an applied 25-activity replay reported all 15
eligible Strava activities already current and zero new versions/errors/downloads.
A full read-only retained replay inspected all 20,301 activities: all 8,235 Strava
and 18 Garmin projections were already current, with zero new projections, stale
results or errors. Complete metric-row digests (including head/projection
timestamps) were unchanged after the applied CLI replay, API GET checks and full
read-only replay. PR #113 is ready for the authorized squash merge; issue/queue closure follows merge.

Additional inspected files: activity-metric-backfill.ts and its tests;
activity-metric-projector.ts; pool.ts; activity-detail V001; operator/Flyway scripts;
official-row verifier; metric repository/tests; canonical Activities repository;
current PR checks and #112 acceptance criteria.


## Visual verification before authorized merge (2026-10-11)

Inspected the live authenticated Activities list, running detail with differing
provider distances, fully processed swim detail and strength detail at the
browser's default desktop viewport. Verified compact-only/processed/not-linked
badges, independent raw-retention labels, selected canonical values, extended
metrics, expanded per-source provenance, and explicit provider controls. No layout
clipping/overlap or browser errors were observed. No Fetch/Refresh was invoked.

The strength metric labels exposed camel-case formatting; corrected them to
human-readable labels without changing keys, values, parser version or stored
projections. Rechecked the API and the rendered strength page. Catalog tests and
root typecheck passed again. Screenshots remain private outside the repository.
The maintainer explicitly authorized squash merge and updating the local main.
