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
reconciliation and rich catch-up await verified legacy record input. Private
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
Historical reconciliation/catch-up is **not claimed complete**: verified legacy
record input/cutoffs are not available in the configured local installation.
No historical cutoff was guessed, no real rich provider download was performed,
and no unprocessed archive is presented as complete. Resolving that input is the
remaining local execution dependency. Full general CI/backend/importer/worker
matrices were not run; focused cross-boundary validation above was used. Merge and
individual-issue closure still require explicit maintainer authorization.

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
