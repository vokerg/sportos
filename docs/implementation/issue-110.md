# Non-scoring walking history (#110)

Maintainer explicitly reprioritized walking after merging #108/#109. Branch
`issue-110-walking-activities` starts from current main. Acceptance: retain Strava
walks in Activities, support conservative Garmin linkage, exclude walking from
scores/workout evidence requirements, then idempotently process retained skipped
Strava summaries without downloads or changes to existing official history.

Inspected before implementation: AGENTS.md, README.md, docs/ARCHITECTURE.md,
docs/ROADMAP.md, docs/AUTHENTICATION.md, docs/AI_ANALYSIS.md,
docs/FRONTEND_ARCHITECTURE.md, docs/adr/0010-garmin-activity-reconciliation.md,
issue #3, open issues/PRs, all primary migration filenames and relevant activity
constraints V002/V118/V124/V127; domain types/scoring/activity-matching; DB schema,
providers/activities/daily-scoring/daily-workout repositories; Strava adapter and
worker sync runner; Garmin day service/projection and helper extract/discovery;
web activity contracts/view model and projection CLI.

Documentation mismatch: #108 excludes walks from linking; this maintainer request
supersedes that exclusion for activity history only. Walking remains non-scoring.
AGENTS.md and roadmap still call merged #109 a draft; update those references.

Invariants: owner context and original raw provenance, provider-native identity,
immutable Garmin audit policy versions, no guessed matches or Garmin-only
canonical promotion, canonical Strava metrics remain authoritative, no implicit
score writes or rich provider downloads during backfill.

## Implementation and additional inspection

Additional inspected paths: packages/shared/src/schemas.ts/canonical-export.ts;
packages/db/src/garmin-activity-schema.ts, ownership-context.ts, pool.ts,
repository-contracts.ts, repositories/canonical-export.repository.ts,
garmin-activities.repository.integration.test.ts,
garmin-strength.repository.integration.test.ts and walking repository tests;
packages/domain/src/daily.ts, steps.ts, rules-studio.ts, scoring.test.ts and
activity-matching.test.ts; packages/importers/src/strava-adapter.test.ts and
provider-types.ts; apps/worker/src/provider-sync-runner.test.ts and
provider-sync-runner.integration.test.ts; apps/api/src/activities controllers,
enrichment service/controller and controller tests, daily day-service/projection
tests; web activity list/detail pages, view-model tests and score-breakdown
contracts; tools/garmin/test_activity_bridge.py/test_fetch_day.py; package.json,
scripts/dev.mjs, scripts/flyway.mjs, .github/workflows/ci.yml,
docs/ACTIVITIES.md, GARMIN_SINGLE_ACTIVITY.md, GARMIN_DAY_FETCH.md and SCORING_RULES.md.
All primary migration contents were collected for migration review; V128 is
append-only and adds no ownership exceptions, grants or score mutations.

Implemented history-only walk contracts/filter/metrics and explicit detail label,
Strava adapter support, Garmin extraction/discovery and immutable match policy v3.
A narrow walking identity alternative uses tight UTC start/elapsed and positive
distance corroboration, retaining differing moving estimates as audited evidence.
Uniqueness and weak competing candidates still prevent automatic linking.
Distinct Strava native IDs stay distinct; exact cross-source walking matches also
require subtype/elapsed agreement. Existing links/rejections remain stable.

Scoring excludes walking explicitly, disallows walking rules and performance
creation, and distinguishes missing walking coverage from incomplete workout
discovery. Legacy excludedIdentities now means non-scoring identities only.
Strava source backfill reuses original source UUIDs/raw versions, shares normal
snapshot construction/ingestion, links historical skipped observations and never
replaces a current provider link with stale data. Ambiguous warnings are persisted
as JSON arrays and remain inspectable. No implicit rich download or score writes.

## Validation

- Root tests, typecheck and production build passed. Root database integrations
  without configured URLs remain explicitly skipped; focused non-owner evidence
  is recorded separately below.
- Non-owner walking/reconciliation/strength integrations passed: latest-source
  selection, idempotence, raw provenance/history preservation, reverse Garmin
  linkage, native-ID separation, current corrected-source protection, ambiguity,
  scoring exclusion, walking-only completeness and cross-account denial.
- Separate dispatcher/worker-data provider sync integration passed.
- Offline Garmin helper tests passed, with one existing optional test skipped.
- Fresh Flyway V001–V128 (37 migrations) passed. V128 populated upgrade passed
  against a disposable V127 database (its prior manual migration history was
  explicitly baselined). Configured primary Flyway migration also passed.
- Live retained-source dry run and explicit backfill succeeded; a subsequent dry
  run returned no eligible records. No Strava download occurred. A bounded live
  walking Fetch retained Garmin resources and uniquely linked the selected walk,
  preserving canonical metrics. No Garmin-only canonical promotion was performed.
- Live before/after digests confirmed all pre-existing non-walking activities,
  daily metrics, ledgers and snapshots were unchanged.
- Walking operation docs, scoring guide, ADR, Activities, architecture, roadmap,
  README and AGENTS.md reflect the new policy and merged #109 status. Private
  payloads, identifiers and local validation artifacts remain outside the repo.

Draft PR #111 remains unmerged. The user-started application remains running.
