# Issue 112: provider activity metrics

Status: implementation started; no merge authorized.

Maintainer explicitly selected #112. Main/origin main were identical at
`3ea765982feba61d8f991270bcb340ba052ba7e4`; no open PRs or competing claims.
Claim: `issue-112-provider-metrics`.

Exit criterion: independent versioned provider metrics and processing coverage,
source-selected read comparison, retained-only resumable backfill, without changes
to canonical activity authority, scoring, ledger, snapshots or Run Lab.

## Investigation before implementation

Inspected: AGENTS.md; README.md; docs/ARCHITECTURE.md; docs/ROADMAP.md;
docs/AUTHENTICATION.md; docs/AI_ANALYSIS.md; docs/FRONTEND_ARCHITECTURE.md;
docs/ACTIVITIES.md; ADRs 0001, 0006, 0010; issue #112 and queue #3 and its claims;
all primary Flyway migrations (schema/function/grant inventory), in detail V124,
V126, and detail resource migrations; root and domain/db/API package manifests;
packages/domain/src/index.ts; packages/db/src/schema.ts and garmin-activity-schema.ts;
repositories activities, Garmin identities/resources/strength, Strava resources;
activity repository integration tests; API activities controller, enrichment,
provider-detail, Garmin local ingestion/review, app.module and db.provider;
provider-detail tests; web Activities list/detail pages, presenter, API client,
provider view models and activity-detail store; local strength projection script;
tools/garmin/extract_activity.py and synthetic extractor fixtures.

Documentation mismatches: #101 list badges remain described as follow-up; #112
owns those additions. Roadmap still calls #111 draft although main includes its
walking migration and there are no open PRs. Historical version status in auth/AI
docs predates current V128; avoid unrelated documentation rewrites.

Mapping evidence: official Strava DetailedActivity reference and Garmin FIT SDK
session profile. Unknown units/developer fields remain raw; primary projection
contains scalar metrics only. No real provider fixture is committed.
