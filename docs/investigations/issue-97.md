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

Additional implementation investigation:
- apps/api/src/app.module.ts and apps/api/src/activities/* tests/services
- packages/db/src/pool.ts and packages/db/src/ownership-context.ts
- packages/db/src/repositories/activities.repository.ts
- packages/db/src/repositories/activity-provider-resources.repository.integration.test.ts
- packages/importers/src/credential-cipher.ts
- apps/worker/src/provider-sync-runner.ts and its integration tests
- docs/garmin-daily-backfill.md
- scripts/flyway.mjs, scripts/ownership-upgrade-fixture.sql,
  scripts/verify-ownership-upgrade.sql

Validation (isolated local PostgreSQL, synthetic records only):
- All primary migration SQL V001–V124 passed as separate migration identity with
  BYPASSRLS; fresh and populated V105 upgrade/verification both passed.
- Dedicated detail migration SQL V001–V002 passed in a separate database.
- API/runtime and worker-data tests used non-superuser, non-BYPASSRLS roles.
- 11 activity/reconciliation/resource integration tests passed, plus 2 existing
  provider-worker integration tests.
- Root typecheck, unit/UI tests and production build passed.
- Flyway CLI execution/Neon gates were not run locally; SQL execution above does
  not validate Flyway history/checksums. Unrelated integration suites skipped in
  root default test were not substituted for the focused explicit database runs.
- Existing resource-cache test cleanup incorrectly requested DELETE although
  dedicated runtime grants omit it. Cleanup now leaves synthetic cache rows in
  the disposable test database instead of broadening runtime privileges.

No live Garmin payload, password, token, activity identifier or sample is in this
PR. Live login, FIT parsing/completeness, resource/blob orchestration and actual
single-activity download belong to #99; full archive #98 stays deferred.

Current integration status (2026-10-07): the investigation above records its
original phase and validation, not a claim that later work is still blocked.
The maintainer authorized merging the three delivery PRs. Current setup,
implemented behavior and remaining scope are maintained in ACTIVITIES.md,
GARMIN_SINGLE_ACTIVITY.md, AUTHENTICATION.md and ROADMAP.md. #97 is the completed
foundation; #99 incremental synchronization and #101 list-wide coverage remain
open follow-ups. Single-activity live retention/linking passed; browser visual
verification remains outstanding after permission was declined.
