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

## Reopening retained Garmin evidence follow-up

Maintainer reported fetched day evidence disappearing when reopening a day.
Before editing, inspected GarminDayStore, its tests, GarminDayCardComponent and
its tests, day transport/model contracts, DailyDetailPageComponent and the
GarminDayService read mapping. The live owner-scoped GET confirmed category
versions and projections remain retained. The store instead resets `expanded`
to false on every route load, whereas Fetch expands the card. Change route load
to display retained categories immediately, including prior successful evidence
on partial days. Missing days and raw resource disclosures remain collapsed.

Follow-up validation: 11 focused Garmin day state/card tests and web typecheck
passed. Chrome reload of the reported day confirmed retained categories remain
expanded, with partial activity coverage visible. No fetch or recalculation was
performed during this investigation; the user-started app remains running.

## Gym session investigation

Maintainer identified a canonical gym workout whose fetched Garmin sets did not
score. Inspected retained primary reconciliation evidence, auxiliary set field
shapes, day activity metadata, activity matching policy, Garmin extraction type
map, enrichment reads, day projection tests and current workout calculation.
Live evidence shows explicit ACTIVE/REST classifications are supported, but gym
moving durations differ across providers and exact-only workout matching requires
explicit review. No automatic link or matching-policy relaxation is justified.
The other discovered activity is explicitly walking, unsupported by the activity
extractor; that failure currently blocks the otherwise complete gym evidence.
Fix known walking discovery to remain inspectable day evidence without being
mistaken for a failed strength extraction. Unknown/partial discovery stays blocked.

Maintainer explicitly authorized linking the identified gym session and improving
matching generally across sports. The selected session was linked through the
existing authenticated audited review endpoint. General improvements must be a
new policy version, preserve historical audits, compare sport-appropriate metrics
and retain uniqueness/subtype/ownership safeguards. Inspect activity-matching
unit tests, Garmin repository integration/schema and the V124 audit constraint
before changing the policy or adding the next append-only migration.

Follow-up delivered: matching policy v2 records sport-specific metric criteria
while preserving immutable v1 audits and established links/rejections; V127 was
applied to the configured local primary. Explicit cached Fetch reconsiders one
pending retained identity, with no downloads. Known walking-only extraction
failures can repair from retained discovery JSON; unknown/workout failures and
incomplete discovery still block replacement.

The explicitly identified live gym session was linked through authenticated
review. Cached day repair and explicit recalculation succeeded: complete linked
strength supplied workout points, canonical metrics were unchanged and ledger
matched score. This supersedes the earlier live-strength validation limitation.
No private identifier, metric, provider sample or matching payload is committed.
Root typecheck/tests/build passed; 15 pure matching tests, 14 non-owner
reconciliation/strength tests and the non-owner primary/detail day-retention
pipeline passed. Fresh 36-version primary migrations through V127 and populated
V127 upgrade passed. Browser inspection was rejected because Computer Use was
not permitted on Chrome's current URL; browser use remained stopped. API and
test validation completed without a browser workaround. The user-started app
remains running; no merge is authorized.

## Walking exclusion follow-up

Maintainer explicitly requested no walking linking attempts or warnings. Inspected
current primary-only workout completeness checks, Garmin day retained coverage
repair/extraction/read paths, raw projection classification, day workflow tests
and card state. Known walking already skips extraction/linking and scoring after
retained classification; remove it from the activity coverage presentation too.
Keep original discovery evidence and all-day step totals. Repair the reported
retained day through cached Fetch and normal explicit recalculation; preserve
unknown/workout failures and immutable score/source history.

Also inspected and updated activity_bridge.py/test_activity_bridge.py so explicit
single-activity discovery excludes walking without creating ambiguity warnings.
Regression tests cover walking with missing metadata, no linking candidate and
no consumption of the selected-day activity limit. API tests and typecheck pass;
Garmin helper suite passes (one existing optional test skipped). The reported
live day was repaired using cached retained data and normal Recalculate: only
the linked run is listed, workout warning is absent, and score/fact values are
unchanged. No Garmin download or personal evidence was committed.
