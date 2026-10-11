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

## Delivered behavior and validation

- Summary first: run distance/pace/moving time, bike distance/speed/moving time,
  swim metres/pace per 100 m/elapsed time; missing fields remain honest.
- Same priority on activity list cards; sport colour accents and responsive layout.
- Kilometres use at most one decimal. Source comparisons retain numeric precision,
  authority, read-only fallback status and advanced provenance.
- Stopped time and other canonical-only fields join secondary metric groups.
- Focused Vitest: 67 tests passed across activity presentation, comparison model,
  comparison UI and page workflows. Web typecheck and production build passed.
- Browser inspection: live run/bike/swim summaries and list ordering, plus swim
  at 390 px width. No Fetch/Refresh/Normalize action was invoked.
- No database/backend/worker/migration or full repository suites were run because
  the change is frontend presentation only. No live facts or scores were written.
- Draft PR #119; issue #118 remains open until an explicitly authorized merge.

## Compact list follow-up — inspection before implementation

Maintainer requested a selectable one-row-per-activity table in the same PR and
shorter list provider labels. Inspected activities-page.component.ts,
activities.store.ts, activity-list.component.ts, activity.view-model.ts and its
tests, ui/provider-metric-status.component.ts, model/activity-metrics.models.ts
and its tests, activities-page.component.test.ts, issue #3/#118 and draft PR #119.
Keep cards as the default; preserve compact view through the URL and navigation.
Detail provider diagnostics retain their expanded presentation.

Delivered a Cards/Compact switch with an allowlisted `view=compact` URL value,
one semantic table row per activity, navigable activity links, horizontal table
scrolling and sport-aware formatted values. Missing values display a dash; time
basis is available on hover and to assistive technology. View-only URL changes
reuse the current query/results, while filter/paging changes still load data.
List badges now show short states (Pending/Ready/Summary only/etc.); detailed
availability distinctions remain on hover and in expanded detail diagnostics.

Follow-up validation: 81 focused tests across five activity model/UI/page files,
web typecheck, build and diff whitespace checks passed. Browser inspection verified
compact table rows, Cards/Compact switching and concise card badges. Backend,
database, worker and full repository suites remain intentionally unrun for this
frontend-only work. No provider download or score write was performed.
