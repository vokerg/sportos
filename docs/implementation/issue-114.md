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
