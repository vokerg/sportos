# Issue 106: Garmin day evidence

Status: implementation and focused validation complete; draft PR #107 remains unmerged.

## Boundary

One explicit completed Garmin calendar date. GET reads retained compact evidence;
POST uses the existing opt-in, non-production, legacy-account local helper.
Each source category retains immutable raw auxiliary content before compact
primary projection. Connect day evidence is separate from CSV observations,
so existing recalculation semantics cannot pick it implicitly. No writes to
canonical facts, official scores, ledger or snapshots. Activities reuse #97/#99.

Partial retries preserve last successful category versions. Full unchanged
fetches reuse retained coverage; explicit refresh requests a new upstream read.
Daily resources are bounded and never eagerly returned with page coverage.

## Investigation

Read issue #106, queue #3 and open PRs (none). #106 was explicitly prioritized
by the maintainer request and added as the active unchecked P3 item in #3. Existing backfill docs
describe an older browser/CSV procedure; this feature adds a separate helper
flow and must not imply that Connect evidence already participates in scoring.
Pinned SDK 0.3.17 source inspected locally: dated summary, day-view weigh-ins
(includeAll), sleep, heart rates, HRV, stress, Body Battery and compact activities.
Actual account/device availability requires a separately selected live date.

Files inspected before implementation (migration structure inspected across
all versions; V124 and detail V002 read in full):

- `AGENTS.md`
- `README.md`
- `apps/api/package.json`
- `apps/api/src/activities/activity-enrichment.service.test.ts`
- `apps/api/src/activities/activity-enrichment.service.ts`
- `apps/api/src/activities/garmin-activities.controller.ts`
- `apps/api/src/activities/garmin-local-ingest.service.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/daily/daily.controller.ts`
- `apps/api/src/db.provider.ts`
- `apps/web/src/app/daily-detail-page.component.ts`
- `apps/web/src/app/features/activities/state/activity-detail.store.test.ts`
- `apps/web/src/app/features/activities/state/activity-detail.store.ts`
- `docs/AI_ANALYSIS.md`
- `docs/ARCHITECTURE.md`
- `docs/AUTHENTICATION.md`
- `docs/FRONTEND_ARCHITECTURE.md`
- `docs/GARMIN_SINGLE_ACTIVITY.md`
- `docs/ROADMAP.md`
- `docs/adr/0002-upload-storage-and-retention.md`
- `docs/adr/0005-authentication-and-data-ownership.md`
- `docs/adr/0006-provider-ingestion-and-strava.md`
- `docs/adr/0009-manual-garmin-csv-staging.md`
- `docs/adr/0010-garmin-activity-reconciliation.md`
- `docs/garmin-daily-backfill.md`
- `flyway/activity-detail-sql/V001__create_activity_provider_resource_cache.sql`
- `flyway/activity-detail-sql/V002__add_staged_garmin_resources.sql`
- `flyway/sql/V001__create_import_tables.sql`
- `flyway/sql/V002__create_activity_tables.sql`
- `flyway/sql/V003__create_scoring_tables.sql`
- `flyway/sql/V004__create_performance_tables.sql`
- `flyway/sql/V005__seed_initial_scoring_rules.sql`
- `flyway/sql/V006__create_summary_views.sql`
- `flyway/sql/V099__uuid_text_compatibility_for_v100.sql`
- `flyway/sql/V100__transactional_idempotent_imports.sql`
- `flyway/sql/V101__remove_uuid_text_compatibility.sql`
- `flyway/sql/V102__document_scoring_semantics.sql`
- `flyway/sql/V103__add_uploaded_files.sql`
- `flyway/sql/V104__add_import_jobs.sql`
- `flyway/sql/V105_1__ensure_runtime_roles.sql`
- `flyway/sql/V105__add_rule_versions_and_recomputation.sql`
- `flyway/sql/V106__add_accounts_and_data_ownership.sql`
- `flyway/sql/V107__hide_owner_from_performance_view.sql`
- `flyway/sql/V108__split_worker_dispatch_and_data_roles.sql`
- `flyway/sql/V109__add_provider_ingestion.sql`
- `flyway/sql/V110__add_read_only_analysis_audit.sql`
- `flyway/sql/V111__require_fast_10k_bonus.sql`
- `flyway/sql/V112__trust_imported_ledgers_and_score_history.sql`
- `flyway/sql/V113__add_manual_daily_fact_authority.sql`
- `flyway/sql/V114__correct_bike_speed_bonus.sql`
- `flyway/sql/V115__add_universal_run_pace_bonus.sql`
- `flyway/sql/V116__add_favourable_run_bonus_rounding.sql`
- `flyway/sql/V117__add_favourable_bike_speed_tolerance.sql`
- `flyway/sql/V118__unify_bonus_points.sql`
- `flyway/sql/V119__add_manual_garmin_csv_staging.sql`
- `flyway/sql/V120__add_garmin_daily_summary.sql`
- `flyway/sql/V121__add_activity_provider_resource_cache.sql`
- `flyway/sql/V122__add_track_run_subtype.sql`
- `flyway/sql/V123__move_activity_provider_resource_cache.sql`
- `flyway/sql/V124__add_garmin_activity_reconciliation.sql`
- `package.json`
- `packages/db/package.json`
- `packages/db/src/garmin-activity-schema.ts`
- `packages/db/src/repositories/garmin-activity-resources.repository.integration.test.ts`
- `packages/db/src/repositories/garmin-activity-resources.repository.ts`
- `packages/db/src/repositories/garmin.repository.ts`
- `packages/db/src/schema.ts`
- `scripts/garmin-local.mjs`
- `tools/garmin/activity_bridge.py`
- `tools/garmin/extract_activity.py`
- `tools/garmin/requirements.txt`
- `tools/garmin/test_activity_bridge.py`

## Validation evidence

- Root typecheck, available tests and production build passed. Unconfigured
  unrelated DB/worker integrations remain skipped in the root run.
- Offline Garmin suite passed (optional old HTTP fixture skipped without its URL).
- Fresh primary V125/detail V003 and populated V124/V002 upgrade checks passed in
  disposable databases; existing score/resource rows were preserved.
- Focused non-owner day/identity/resource integrations and a real repository-backed
  synthetic day pipeline passed, including unchanged canonical/score/ledger/snapshot
  rows, RLS isolation and denied dispatcher/worker-data access.
- User-selected live completed-day fetch and retained replay passed; original
  resources and successful links were retained with official rows unchanged.
  Empty sleep/HRV values remain not recorded, not zeros. Primary V125 and detail
  V003 applied locally using separate migration identities. No personal data,
  tokens, source identifiers, hashes or local paths added to version control.
- Visual browser inspection has not been performed.
