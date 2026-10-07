# Issue 97 investigation

Maintainer authorization (2026-10-07): implement the reconciliation blocker for
single-activity Garmin Connect work (#99), deferring full archive upload (#98).
Issue #3 still labels Garmin as planning-only; this explicit request activates
#97. No open PRs or active #97 claim were present. Branch starts at current main
06e6dc1aca96e666f0b8d8b11ecb155cfea7446c.

Exit criterion: retain Garmin identity and bounded matching metadata, safely link
one canonical activity without changing its fields/scores, stage unresolved
records, reconcile later Strava arrival, and allow audited explicit resolution.
No Garmin network access, credentials, bulk import, or score write is required.

Inspected before implementation:
- AGENTS.md, README.md
- docs/ARCHITECTURE.md, docs/ROADMAP.md, docs/AUTHENTICATION.md
- docs/AI_ANALYSIS.md, docs/FRONTEND_ARCHITECTURE.md, docs/ACTIVITIES.md
- docs/adr/0006-provider-ingestion-and-strava.md
- package.json, packages/db/package.json, packages/importers/package.json
- packages/domain/src/index.ts, packages/domain/src/types.ts
- packages/db/src/index.ts, packages/db/src/schema.ts
- packages/db/src/repositories/providers.repository.ts
- packages/db/src/repositories/activity-provider-resources.repository.ts
- packages/db/src/repositories/activities.repository.integration.test.ts
- packages/importers/src/provider-types.ts
- apps/api/src/activities/activities.controller.ts, apps/api/src/db.provider.ts
- .github/workflows/ci.yml
- flyway/sql/* (schema/constraint/policy/trigger/grant inventory, V001–V123)
- flyway/activity-detail-sql/V001__create_activity_provider_resource_cache.sql
- GitHub #3, #97, #98, #99 and open PR list

Documentation mismatches: ROADMAP baseline says V119 and AI_ANALYSIS validation
says V122; README/auth deployment reflect V123 and the separate detail database.
ADR 0006 exact cross-source matching remains correct for Strava ingestion, but
requires a separately versioned Garmin policy. Garmin local authentication must
not be bolted onto Strava OAuth or server-side credential storage.
