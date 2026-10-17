# Issue 151: unified distance leaderboard (in progress)

The leaderboard combines original Excel achievements with current measured retained
efforts. Excel 21,100 m is normalized to the 21,097.5 m target only at read/match
time. Original rows and times remain unchanged; 12 km stays retained but excluded.
Algorithm v5 adds measured marathon support using the existing window algorithm.
Historical v4 projections require explicit retained reprocessing.

Reconciliation policy v1 uses the canonical local date, minimum target distance
with the existing bounded tolerance, treadmill compatibility, and summary moving
pace. It never requires streams or reproduces interval time. Pace must be 120–900
s/km. Whole-run average may be up to 15% faster than the historical target pace,
or slower by 15% plus 20% per extra target-length (capped at 45%). Scores are
100 minus absolute percentage pace difference, minus 10 for unknown subtype;
minimum 65 and decisive margin 12. Near scores remain ambiguous. Adjacent-date
candidates are visible for explicit operator review only. No inferred timezone
shift is automatically accepted. Multiple event distances may share one activity.

Automatic replay preserves accepted and operator decisions. Owner-scoped immutable
decisions and mutable heads survive workbook re-imports. The reconciliation lock
serializes candidate inspection and publication with provider reconciliation.

Displayed-time precedence: original Excel, current calculated Strava streams,
current calculated Garmin FIT. One activity/target ranks once; other evidence is
retained as alternatives. Repeated workbook achievements for one activity/target
are alternatives too, with the fastest historical time displayed. Equal times use
date then stable identifier. Whole-run provider performance events and estimates
never rank. Rank is computed from qualified inputs before the output limit.
Coverage is separate; categories can overlap and never imply archive completeness.

## Investigation

Inspected README, ARCHITECTURE, ROADMAP, AUTHENTICATION, AI_ANALYSIS,
FRONTEND_ARCHITECTURE, RUNNING_EFFORTS, ACTIVITIES; ADRs 0001/0005/0006/0010;
all primary migration names and DDL/security inventory through V136, with full
V004/V106 ownership keys/V133 definitions; import-service/run-db/my-sport importers;
performance/running-efforts/activity-metrics repositories; effort projector,
backfill/schema; domain performance/running-efforts and tests; API performance
controller/tests, provider detail service, running efforts service, activity
controller, DB provider and development auth endpoint; Run Lab and performance
transport/models; root/db package scripts, pool, dev/migration/backfill scripts.

Documentation mismatch: prior docs intentionally exclude measured effort rankings;
#151 changes that boundary only for qualified analytical leaderboards. Timing is
pause-excluded analytical evidence, not certified race records. Scoring is unchanged.

## Validation / operations

Focused implementation validation is complete as documented below. Historical
record import and reconciliation have now been executed; rich catch-up remains
a separate bounded operation. Private
aggregate inventory stays local; personal measurements, provider payloads,
credentials and raw history are excluded from this branch.

## Implemented operator and UI workflows

`performance:reconcile` provides bounded dry-run/apply/cursor batches and explicit
single-record candidate review/accept/reject. Stored decisions are shown separately
from new scorer proposals. `performance:catchup` unions per-target eligible runs,
uses compact auxiliary metadata, reprocesses current retained streams before any
request, and invokes existing authenticated Fetch Detail only for explicit apply.
It persists an external private atomic checkpoint, rate-limit retry times and
scope/cutoff metadata, and stops before failed work. One serial batch per invocation;
no automatic bulk action in the UI, GETs or ordinary sync. Missing historical
cutoffs block the default operation; an explicit operator date range is supported.
Unavailable evidence needs explicit retry/refresh. No full Garmin fetch is added.

Run Lab adds a feature-owned leaderboard container, route-lifetime signal store
and feature data-access/models. It shows source/timing semantics, bounded
alternatives, canonical/original navigation, separately explained coverage and
loading/error/empty states. The original table is labeled performance event
history with explicit source labels, so whole-run provider events are visibly
separate from qualified window rankings. Target choices come from the API/domain
catalog; range validation reuses the shared calendar helper.

## Validation completed

- 23 deterministic domain tests: summary-only many-to-one identity, decisive and
  ambiguous pace contrasts, longer/slower runs, local-date drift, treadmill flags,
  excluded 12 km, normalized HM, native marathon windows and all existing pause,
  coverage, gap, distance-tolerance, interpolation and tie cases.
- 23 focused DB/projector tests using disposable non-owner primary/detail roles:
  reconciliation preview/apply/replay, accepted/rejected operator decisions,
  workbook pointer preservation, source/algorithm/resource-intent freshness,
  original-time precedence, estimated/failed exclusion, bounded alternatives,
  stable occurrence identity, target union/cutoffs/cursor/cache reuse, cross-owner
  reads/FKs, immutable audit history and dispatcher denial. Existing retained
  effort integration asserts unchanged nonempty canonical/day/ledger/snapshot/
  performance facts, independent sources, safe retry and publication races.
- 17 focused API tests covering leaderboard allowlists/ranges/limits, existing
  performance routes, effort publication and authenticated session/CSRF boundaries.
- 18 focused web tests covering store cancellation/error/retry/calendar validation,
  source/alternative rendering, navigation, empty/loading states, existing Run Lab
  and per-activity effort rendering.
- Five synthetic operator runner tests cover serial deduplication, rate-limit stop
  and checkpoint, bounded transient retry, crash/replay after retention and action
  bounds. Added to the fast CI workflow.
- Root `pnpm typecheck`, web architecture checks (eight guard regression tests),
  Angular production build and `git diff --check` passed.
- Fresh Flyway application/validation of all 46 primary migrations through V137;
  fresh separate detail DDL through its current migrations; populated V136 → V137
  upgrade compares complete synthetic official rows and asserts no projections.
- Synthetic local API end-to-end: catch-up preview writes/fetches nothing; explicit
  authenticated/CSRF apply reprocesses retained evidence; checkpoint resume does
  no duplicate work. Synthetic provider authorization is absent, so no real
  provider request is possible in this validation.
- Local application V137 migration and bounded retained-only reprojection were
  verified with aggregate results and full official-row digest comparison. No
  canonical/day/ledger/snapshot/performance row changed. Local Run Lab was checked
  in Chrome for source labels, alternative evidence, current results and separate
  coverage; API health and leaderboard GET succeeded.

Private aggregate inventory and verification reports stay outside the repository.
The maintainer subsequently supplied the original workbook. It has now been
inspected in Google Sheets, exported privately, imported through normal authenticated
upload/leased-worker orchestration and reconciled using summary-only evidence.
The previous missing-input dependency is resolved. A complete source replay
preserved achievement identities/times and reconciliation heads. Ambiguous and
unmatched records remain available for explicit review. Historical rich catch-up
has been previewed with the derived cutoffs but is **not claimed complete**; no
unprocessed archive is presented as complete and no real rich provider download
was performed during this import follow-up. Focused cross-boundary validation
above and the full GitHub CI build passed. The maintainer has authorized squash
merge of PR #152 and transfer of all unfinished operational work to
[#153](https://github.com/vokerg/sportos/issues/153): bounded historical rich
catch-up, ambiguous/unmatched record review, live refresh and final coverage/
official-data verification. This transfer does not claim archive completeness.

## Additional actual files inspected

- `AGENTS.md`, `.github/workflows/ci.yml`, `.env.example`, `.gitignore`, root/package
  TypeScript and package manifests.
- `packages/db/src/pool.ts`, `index.ts`, `schema.ts`,
  `running-effort-schema.ts`, `activity-metric-backfill.ts`,
  `running-effort-backfill.ts`, `running-effort-projector.ts`,
  `repositories/activity-provider-resources.repository.ts`,
  `repositories/activity-metrics.repository.ts`,
  `repositories/running-efforts.repository.ts`,
  `repositories/running-efforts.repository.integration.test.ts`.
- `packages/domain/src/index.ts`, `performance.ts`, `running-efforts.ts`,
  `running-efforts.test.ts`; `packages/importers/src/run-db.importer.ts`,
  `my-sport.importer.ts`, `import-service.ts`, `strava-adapter.ts`,
  `provider-types.ts`.
- `apps/api/src/main.ts`, `app.module.ts`, `db.provider.ts`,
  `query-validation.ts`, `auth/auth.controller.ts`, `auth/auth.service.ts`,
  `auth/auth.models.ts`, `auth/session.guard.ts`,
  `performance/performance.controller.ts`,
  `performance/performance.controller.test.ts`,
  `activities/activities.controller.ts`,
  `activities/activity-provider-detail.service.ts`,
  `activities/running-efforts.service.ts`,
  `activities/running-efforts.service.test.ts`.
- `apps/web/src/app/app.routes.ts`, `run-lab.component.ts`,
  `run-lab.component.test.ts`,
  `features/performance/data-access/performance-api.service.ts`,
  `features/performance/model/performance.models.ts`,
  `features/activities/ui/running-efforts.component.ts`,
  `features/activities/ui/running-efforts.component.test.ts`,
  `features/providers/state/provider.store.test.ts`,
  `shared/util/analytics-query-state.ts`.
- `scripts/dev.mjs`, `flyway.mjs`, `running-efforts-backfill.mjs`,
  `garmin-reconcile-retained.mjs`, `running-efforts-upgrade-fixture.sql`,
  `verify-running-efforts-upgrade.sql`; `docs/implementation/issue-122.md`.
- All new/changed #151 files were inspected during implementation and self-review.

## Verified workbook import follow-up

The maintainer supplied a legacy Google workbook after the initial DB inventory.
Direct source inspection revealed an export naming ambiguity (`1/2` → `12`), a
mixed distance/time/date helper layout and duplicated worksheet views. The old
parser would misclassify half marathons and interpret distance values as time.
The corrected parser verifies explicit native distance/date/time evidence,
retains physical row addresses without changing existing source hash identity,
and links exact helper-view duplicates to one achievement. Independent/ambiguous
source evidence is preserved. A normalization-conflict guard prevents silently
rewriting existing date/time/distance interpretations. No private workbook,
source URL, personal dates/times, provider IDs or raw reports are committed.

Provenance linking now uses bounded SQL batches with existing last-write and RLS
semantics. Reconciliation inspects and publishes one bounded automatic batch under
one account lock, avoiding remote per-record round trips. Single-record review
uses the same deterministic hash field order; replay across both paths creates no
duplicate decisions. Accepted/operator decisions remain protected.

Catch-up defaults select only targets with actual Excel cutoffs. New catalog
targets without historical rows are computed opportunistically for selected runs;
a bounded explicit from-date is required to scan their older history. This avoids
turning an absent cutoff into an implicit full-archive download.

Additional validation: six export-layout/identity tests, three non-owner import/
provenance/replay/conflict/isolation integration tests, existing six importer
transaction/history integrations, two split-role worker import integrations and
20 API upload/controller tests passed. All 27 importer unit tests pass; the
owner-scoped batch/leaderboard suite now has seven passing tests. The existing
import fixture's expected base/bonus split was updated to the already-established
V118 semantics; scoring code and total were unchanged. Root typecheck/backend
build pass. Live import retains all original source rows, core official-row
comparison is unchanged, reconciliation dry-run/apply agree, and real source
re-import preserves every original achievement identity/time and accepted mapping.
Counts, date ranges and candidate diagnostics remain in private local reports.

Additional inspected files: `packages/importers/src/xlsx-reader.ts`,
`run-db.importer.ts`, `import-service.ts`, `xlsx-fixtures.test.ts`,
`test-fixtures/xlsx-fixtures.ts`, `import-service.integration.test.ts`,
`import-history.integration.test.ts`, `upload-storage.ts`; `packages/shared/src/dates.ts`;
`packages/db/src/repositories/imports.repository.ts`, `import-jobs.repository.ts`;
`apps/api/src/imports/imports.controller.ts`, `imports.service.ts`,
`workbook-upload.test.ts`; `apps/api/src/storage/upload-storage.ts`;
`apps/worker/src/import-job-runner.ts`, `import-job-runner.integration.test.ts`;
`flyway/sql/V001__create_import_tables.sql`, `V101__remove_uuid_text_compatibility.sql`.
