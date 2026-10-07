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

## Delivered behavior and validation

V126 adds forced-RLS, same-owner, append-only compact strength summaries and
source-neutral workout rule UUIDs. Original set JSON remains in the detail store.
Explicit recalculation reads primary evidence only, uses Connect before CSV,
preserves positive manual overrides and incomplete workout fallbacks, and records
step/workout provenance in snapshots/ledgers. Cached explicit Fetch can project
already-retained strength resources without downloading. Activity detail refreshes
its compact summary after Fetch. Generation receives aggregate calculation inputs
without Garmin identity/version/retrieval metadata.

Additional inspected files: analysis-tool.service.ts and its tests,
activity-enrichment.service.ts, activity-detail.store.ts and tests,
canonical-export.repository.ts, garmin-local-ingest.controller.test.ts,
activity_bridge.py. Existing daily integration assertions were corrected to use
account context, normalize a numeric DB value, read nested rule codes, and count
only newly appended snapshots while retaining earlier history across repeats.

Validation:

- Root typecheck, tests and production build passed. Optional integrations remain
  skipped in the root suite when dedicated test URLs are absent.
- Fresh primary migration set (35 versions through V126) passed on a disposable
  local database; V126 also passed on the existing populated upgrade fixture.
- Non-owner API-role strength/reconciliation/day repository integrations passed
  (16 tests); legacy-role daily-scoring integration passed (7 tests).
- Non-owner primary/detail day-retention pipeline passed and proved Fetch alone
  leaves official rows unchanged. The separate activity-enrichment HTTP test was
  skipped because its additional configuration was not supplied.
- Focused normalization/source-resolution/analysis privacy/UI tests passed,
  including cancellation of compact summary refresh after navigation.
- V126 was applied via Flyway to the configured local primary database. Private
  before/after digests confirmed that the migration changed no selected-day
  canonical rows, daily score, ledger or snapshots.
- Chrome explicit recalculation on the selected previously retained completed day
  passed: Connect step equation, canonical run/swim totals, calculated status and
  ledger equality were visible. Canonical activity rows were unchanged, exact
  prior snapshot rows were preserved, and one new snapshot was appended.
- Live strength remains unverified: the selected day contains run/swim evidence,
  and no recorded strength sets are currently retained. Strength policy and
  scoring are covered by synthetic fixtures and real non-owner persistence.

No personal sample, metric, identifier, hash, screenshot or credential is
committed. Live screenshot and private verification artifacts remain outside the
repository. PR #109 remains draft; no merge or issue completion is authorized.
