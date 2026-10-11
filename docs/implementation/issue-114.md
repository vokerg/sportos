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
