# Activity metric hierarchy (#118)

Maintainer explicitly reprioritized this frontend presentation work. Acceptance:
sport-specific highlights, concise precision, responsive visuals, preserved source
comparisons/provenance and explicit fetch workflows. No canonical/scoring changes.

## Inspection before implementation

- AGENTS.md
- README.md
- docs/ARCHITECTURE.md
- docs/ROADMAP.md
- docs/AUTHENTICATION.md
- docs/AI_ANALYSIS.md
- docs/FRONTEND_ARCHITECTURE.md
- docs/ACTIVITIES.md
- docs/ACTIVITY_METRICS.md
- docs/adr/0010-garmin-activity-reconciliation.md
- apps/web/package.json
- apps/web/src/styles.css
- apps/web/src/app/features/activities/activity-detail-page.component.ts
- apps/web/src/app/features/activities/activity-list.component.ts
- apps/web/src/app/features/activities/activities-api.service.ts
- apps/web/src/app/features/activities/activity.view-model.ts
- apps/web/src/app/features/activities/activity.view-model.test.ts
- apps/web/src/app/features/activities/provider-detail.view-model.ts
- apps/web/src/app/features/activities/model/activity-metrics.view-model.ts
- apps/web/src/app/features/activities/model/activity-metrics.view-model.test.ts
- apps/web/src/app/features/activities/ui/activity-metric-comparison.component.ts
- apps/web/src/app/features/activities/ui/activity-metric-comparison.component.test.ts
- Issue #3, open issues, active claims and open PRs (none).

Documentation mismatch: Activities documents the previous undifferentiated grouping
and two-decimal comparison example; update it with the new display hierarchy.

The existing supplemental canonical cards precede comparisons, so stopped time
can become the first and only top card. Merge canonical-only fields into the
secondary metric groups and prioritize sport-specific summary metrics first.
