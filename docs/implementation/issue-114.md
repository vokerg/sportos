# Activity metrics UI (#114)

## Investigation before implementation

Baseline main: `7b2e95b` (merged #113). #112 is already closed. No open PRs.
Maintainer explicitly reprioritized this separate frontend issue in #3.

Inspected files: `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`,
`docs/ROADMAP.md`, `docs/AUTHENTICATION.md`, `docs/AI_ANALYSIS.md`,
`docs/FRONTEND_ARCHITECTURE.md`, `docs/ACTIVITIES.md`,
`docs/ACTIVITY_METRICS.md`, ADRs 0006, 0007 and 0010,
`apps/web/package.json`, `.github/workflows/ci.yml`,
`packages/domain/src/activity-metrics.ts`,
`packages/db/src/repositories/activity-metrics.repository.ts`, and under
`apps/web/src/app/features/activities/`: `activities-api.service.ts`,
`activity.view-model.ts`, `activity-detail-page.component.ts`,
`activities-page.component.test.ts`, `model/activity-metrics.models.ts`,
`model/activity-metrics.models.test.ts`, `state/activity-detail.store.test.ts`,
`ui/activity-metric-comparison.component.ts`, `ui/provider-metric-status.component.ts`.

Documentation mismatch: canonical absence in ACTIVITY_METRICS remains correct for
API selection; the UI will now display a labelled read-only Garmin fallback.
The UI cadence comparison will convert explicit running conventions without
changing the versioned catalog or persisted units. Queue #3 contains stale
unrelated delivery checkboxes; only #112 and this issue are updated here.

Invariant: display transformations never write canonical activity/scoring data.
Exit criterion: readable grouped comparisons with explicit authority, retained
advanced provenance and unchanged provider workflows, verified by focused tests,
web typecheck/build and self-review. No backend/migration/full CI matrix needed.

## Implementation and self-review

- Replaced Selected/candidate repetition with one grouped metric row. Equal
  values combine source labels; disagreement preserves Strava-first order and
  bold styling on the primary value only when values disagree. Manual/workbook authority remains visible.
- Added documented absolute display tolerances, sport-aware units/precision and
  run-only cadence conversion. Explicit Garmin running fields win over Garmin
  generic cadence; already normalized steps/min are never doubled again.
- Garmin fills display gaps only as Read-only fallback. Current API candidates
  and selection are unchanged; no canonical, scoring or persistence code changed.
- Moved complete competing-field provenance into the existing Source and
  provenance advanced area. Supplemental canonical cards retain facts missing
  from the catalog while omitting fields already shown in comparisons.
- Provider controls, normalization statuses and workflow store are unchanged.
- Added jsdom as a pinned dev-only test dependency for actual Angular DOM
  rendering. Production bindings also pass Angular's production compiler.

Self-review checked all nine requirements against implementation/tests, reviewed
page composition and catalog units, confirmed immutable input/provenance data,
absence of provider/write calls in the presenter, and scoped the dependency and
lockfile changes. Fixed a non-transitive tolerance grouping edge case found in
review and retained fractional pool-length precision. Updated the #112 roadmap
wording from draft to merged, matching GitHub.

## Validation

- Seven focused Vitest files: **69 tests passed**, including 40 pure presenter
  tests, six rendered comparison/provenance/input-update tests, and existing
  activity page/provider workflow/formatting regressions.
- `pnpm --filter @sportos/web typecheck`: passed.
- `pnpm --filter @sportos/web build`: passed after final implementation changes.
- `pnpm install --frozen-lockfile --offline`: passed.
- `git diff --check`: passed.

No live personal-data browser review was performed. No migrations, database,
backend/worker integrations or full repository suite were run: this change is
frontend-only. Commit messages use [skip ci] to avoid the existing heavy
repository-wide workflow as requested; focused validation is recorded here.
#114 stays open and its queue box unchecked until merge. PR is ready for review;
no merge is authorized.

Maintainer follow-up: removed repeated Authoritative badges. Equal/single values
receive no authority emphasis; disagreement uses bold styling explained once.
Rendered regression tests verify badge absence and primary-value styling.

## Maintainer scope addition: day-to-activity navigation

The maintainer explicitly requested clickable activities on the day page in the
same review. Inspected `score-breakdown-activities.component.ts`,
`score-breakdown.models.ts`, `score-breakdown-panel.component.test.ts`,
`daily-detail-page.component.ts`, `app.routes.ts` and the closest activity-name
presenter. Canonical activity IDs already exist in day rows; no API change is
needed. The activity name now links to `/activity/:id` with normal RouterLink
navigation and keyboard focus styling. No source IDs or score entries are used
as navigation identity.

Day-link validation: nine tests across the rendered activity-table, day-page and
panel files passed. Web typecheck/build and whitespace check passed. The rendered
test verifies both Strava/manual URLs use canonical IDs and a click invokes the
router with the correct activity route.

## Maintainer scope addition: swim bonus ladder

The maintainer explicitly requested this scoring policy in the same issue/PR
and confirmed one bonus per swim. Policy: one highest tier per canonical swim
of at least 1,000 m, using elapsed seconds per kilometre; strict thresholds of
20:00/19:30/19:00/18:30 award 2,000/3,000/4,000/5,000. No block multiplier,
no additional tiers, no provider fetch, no moving-time substitution.

Before implementation inspected all primary Flyway migration declarations and
full V003, V005, V115, V116, V117, V126; domain scoring/types/tests and Rules
Studio validation; day scoring repository unit/integration tests and lock
boundaries; Rules Studio metric options; Flyway wrapper; ADRs 0004/0008; scoring
semantics and earlier scoring implementation evidence. Existing V129 is the
latest migration; V130 will be append-only. No table/type shape changes are
needed. The selected live day was inspected read-only; no personal payload,
identifier or metric is added to this document or committed fixtures.

This expansion crosses domain/database boundaries, so focused domain, Rules
Studio and disposable-database migration/upgrade/account tests are necessary.
The frontend-only validation limitation above applies to the original UI scope.

## Swim policy validation and self-review

- Domain scoring/Rules Studio: 55 tests passed (23 new swim cases plus existing
  scoring and proposal regressions).
- Daily step/workout resolution: 12 focused tests passed.
- API daily/rules controllers: 17 focused tests passed.
- Web Rules Studio: 10 focused tests passed; swim pace is an explicit metric
  choice so migrated rules remain editable/previewable through the existing UI.
- Non-owner `sportos_app` swim repository: two integration tests passed on a
  disposable loopback database, including new-account rule seeding, one exact
  rule-linked contribution, repeated recalculation/history and foreign-ID denial.
- Fresh Flyway: all 39 primary migrations through V130 passed.
- Populated V129→V130: 45 synthetic dates across three owners passed boundary,
  longer/short/zero/missing swim cases, manual/imported status, disjoint enabled
  ranges, untouched customized account rules, base/unrelated ledger preservation,
  canonical equality and append-only snapshot/metadata checks. A fourth custom
  owner is preserved independently. Fixture errors were corrected before live use.
- Root typecheck and web production build passed; no full repository test matrix
  or heavy remote CI was run.

Self-review matched SQL tier selection and ledger inputs to domain evaluation,
checked date/owner joins and transaction locks, preserved exact prior UUIDs and
snapshot facts/provenance, and verified that version numbering handles multiple
legacy effective ranges. Kysely shapes/grants/RLS are unchanged; this migration
adds rule data and recalculates only related contributions, not new tables.

With the maintainer's requested local fix, V130 was applied via the existing
schema-owner Flyway configuration to the configured local primary database.
Private before/after digests proved canonical activity fields, imported daily
rows, unrelated ledger rows and every prior snapshot unchanged. Browser read-only
verification of the requested calibration day confirmed one matching swim tier,
updated bonus/total and ledger equality. No provider call or additional explicit
recalculation was needed; no live date, ID, payload, metric, screenshot, hash or
credential is committed. Only synthetic fixtures are checked in. The PR remains
open; no merge is authorized.
