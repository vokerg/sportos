# Retained Garmin day recalculation (#108)

Branch: `issue-108-enriched-day-recalculation`, from current main.

## Investigation before implementation

Read issue #108, dependency #106/PR #107, authoritative queue #3 and open PRs
(none active). #108 was explicitly prioritized by the maintainer. Main includes
#107. Exit criterion: explicit one-day recalculation consumes retained Connect
steps and complete linked strength summaries with immutable provenance, source
precedence, primary-only scoring transactions and no provider calls.

Inspected files:

- AGENTS.md, README.md, package.json
- docs/ARCHITECTURE.md, docs/ROADMAP.md, docs/AUTHENTICATION.md,
  docs/AI_ANALYSIS.md, docs/FRONTEND_ARCHITECTURE.md, docs/SCORING_RULES.md,
  docs/GARMIN_DAY_FETCH.md, docs/GARMIN_SINGLE_ACTIVITY.md
- docs/adr/0004-rule-versioning-and-recomputation.md,
  docs/adr/0008-imported-ledger-authority-and-explicit-recalculation.md,
  docs/adr/0010-garmin-activity-reconciliation.md
- All flyway/sql migration declarations; full V105.1, V118, V124 and V125
- scripts/dev.mjs, scripts/flyway.mjs, .github/workflows/ci.yml
- packages/domain/src/index.ts, scoring.ts
- packages/db/package.json; src/index.ts, schema.ts, pool.ts,
  repository-contracts.ts, garmin-activity-schema.ts, garmin-day-schema.ts,
  score-breakdown-contract.ts
- packages/db/src/repositories/daily-scoring.repository.ts and its unit/integration
  tests, daily.repository.ts, activities.repository.ts, rule-changes.repository.ts,
  garmin-activities.repository.ts, garmin-activity-resources.repository.ts,
  garmin-day.repository.ts and its integration test
- apps/api/src/activities/garmin-local-ingest.service.ts,
  activity-enrichment.integration.test.ts
- apps/api/src/daily/garmin-day.service.ts, garmin-day-projection.ts,
  garmin-day.integration.test.ts
- apps/web/src/app/score-breakdown-facts.component.ts, score-breakdown.models.ts
- apps/web/src/app/features/activities/activity-detail-page.component.ts,
  activities-api.service.ts, activity.view-model.ts, provider-detail.view-model.ts
- tools/garmin/extract_activity.py, test_extract_activity.py

Documentation mismatches: scoring/architecture/ADR 0008 still describe requiring
Strava for every recalculation and preserving all stored steps/workout values.
Current implementation permits an existing daily row or exact CSV step evidence.
Roadmap still labels merged #107 as draft. Update these descriptions with #108.

Live evidence inspected privately: the selected completed Saturday has retained
Connect summary/activity discovery and run/swim resources. No strength resource
with recorded sets is currently retained. Personal payloads and metrics must not
be committed; strength classification requires explicit types and fails closed
for unrecognized shapes.
