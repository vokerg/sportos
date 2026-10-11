# Issue 120: Garmin run types and daily source indicators

## Investigation before implementation

Issue #120 is explicitly prioritized by the maintainer; #3 and open issues/PRs checked. Current main is 30ae91c; no open PRs. The queue still describes #116/#106 PRs as active although they are already incorporated in main; no conflicting work exists.

Inspected files:

- `AGENTS.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/AUTHENTICATION.md`
- `docs/AI_ANALYSIS.md`
- `docs/FRONTEND_ARCHITECTURE.md`
- `docs/adr/0010-garmin-activity-reconciliation.md`
- `docs/adr/0006-provider-ingestion-and-strava.md`
- `docs/ACTIVITY_METRICS.md`
- `package.json`
- `packages/db/package.json`
- `packages/domain/src/activity-matching.ts`
- `packages/domain/src/activity-matching.test.ts`
- `packages/db/src/repositories/activities.repository.ts`
- `packages/db/src/repositories/activities.repository.integration.test.ts`
- `packages/db/src/repositories/garmin-activities.repository.ts`
- `packages/db/src/repositories/garmin-activities.repository.integration.test.ts`
- `packages/db/src/repositories/daily.repository.ts`
- `packages/db/src/repositories/cockpit.repository.ts`
- `packages/db/src/garmin-day-schema.ts`
- `packages/db/src/schema.ts`
- `packages/db/src/repository-contracts.ts`
- `packages/importers/src/strava-adapter.ts`
- `tools/garmin/extract_activity.py`
- `scripts/garmin-reconcile-retained.mjs`
- `scripts/activity-metrics-backfill.mjs`
- `apps/web/src/app/features/activities/activities-api.service.ts`
- `apps/web/src/app/features/activities/activity.view-model.ts`
- `apps/web/src/app/features/activities/activity.view-model.test.ts`
- `apps/web/src/app/features/activities/activity-list.component.ts`
- `apps/web/src/app/features/activities/activity-detail-page.component.ts`
- `apps/web/src/app/features/daily/model/daily.models.ts`
- `apps/web/src/app/features/daily/model/daily-quick-entry.models.ts`
- `apps/web/src/app/daily-log-grid.component.ts`
- `apps/web/src/app/daily-quick-entry-grid.component.ts`
- `apps/web/src/app/daily-breakdown-button.component.ts`
- `apps/web/src/app/daily-log-presenters.component.test.ts`
- `apps/web/src/app/score-breakdown.view-model.ts`

## Invariants and exit criteria

Use explicit Garmin compact run subtypes through current owner-scoped links. Preserve canonical subtype/metrics and all score history. Display/filter classification is separate from scoring. Old linked runs receive the same read projection as new links without data rewrites. Pending treadmill identity matching may disregard only Strava default outdoor subtype, with tight independent start/elapsed/distance corroboration and unique candidates; all explicit conflicts, manual sources and ambiguous cases stay closed. Daily source coverage uses compact retained evidence only, no rich queries or downloads.
