# Running best efforts (#122)

Issue #122 is the first ready item in queue #3. No active PR/claim was present. Branch starts at current main `aea4634`. Issue #100 was inspected: broader detail models, archive #98 and recurring #99 remain independent.

Exit criterion: independently versioned, pause-excluded Strava/Garmin per-run efforts with honest summary estimates, compact owner-scoped persistence, retained-only backfill and detail UI. No canonical/scoring/performance mutation or automatic provider download.

Documentation mismatches before implementation: ROADMAP lists schema V130 while main has V132; queue retains older draft/open status text for already merged phases. #100 still describes earlier navigation fetch behavior; current explicit-fetch storage boundaries take precedence.

## Inspected before implementation

GitHub issues #122, #3 (body and claims), #100 and open PR list. File inspection includes migration structure across every primary migration, with V129 read fully for projection constraints.

- `AGENTS.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/AUTHENTICATION.md`
- `docs/AI_ANALYSIS.md`
- `docs/FRONTEND_ARCHITECTURE.md`
- `docs/ACTIVITIES.md`
- `docs/ACTIVITY_METRICS.md`
- `docs/GARMIN_SINGLE_ACTIVITY.md`
- `docs/GARMIN_DAY_FETCH.md`
- `docs/adr/0002-upload-storage-and-retention.md`
- `docs/adr/0005-authentication-and-data-ownership.md`
- `docs/adr/0006-provider-ingestion-and-strava.md`
- `docs/adr/0010-garmin-activity-reconciliation.md`
- `packages/importers/src/strava-adapter.ts`
- `tools/garmin/extract_activity.py`
- `apps/api/src/activities/activity-provider-detail.service.ts`
- `apps/api/src/activities/activity-provider-detail.service.test.ts`
- `apps/api/src/activities/activity-enrichment.service.ts`
- `apps/api/src/activities/activity-enrichment.service.test.ts`
- `apps/api/src/activities/garmin-local-ingest.service.ts`
- `apps/api/src/daily/garmin-day.service.ts`
- `apps/api/src/activities/activities.controller.ts`
- `apps/api/src/app.module.ts`
- `packages/db/src/repositories/activity-provider-resources.repository.ts`
- `packages/db/src/repositories/garmin-activity-resources.repository.ts`
- `packages/db/src/repositories/activity-metrics.repository.ts`
- `packages/db/src/repositories/activity-metrics.repository.integration.test.ts`
- `packages/db/src/activity-metric-projector.ts`
- `packages/db/src/activity-metric-backfill.ts`
- `packages/db/src/activity-metric-schema.ts`
- `packages/db/src/repositories/activities.repository.ts`
- `packages/db/src/repositories/performance.repository.ts`
- `apps/api/src/performance/performance.controller.ts`
- `apps/web/src/app/run-lab.component.ts`
- `apps/web/src/app/features/activities/activity-detail-page.component.ts`
- `apps/web/src/app/features/activities/activities-api.service.ts`
- `apps/web/src/app/features/activities/state/activity-detail.store.ts`
- `apps/web/src/app/features/activities/state/activity-detail.store.test.ts`
- `packages/db/src/schema.ts`
- `packages/db/src/index.ts`
- `packages/domain/src/index.ts`
- `scripts/activity-metrics-backfill.mjs`
- `package.json`
- `packages/domain/package.json`
- `packages/db/package.json`
- `apps/api/package.json`
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
- `flyway/sql/V125__add_garmin_day_evidence.sql`
- `flyway/sql/V126__add_garmin_strength_scoring_evidence.sql`
- `flyway/sql/V127__version_garmin_match_policy.sql`
- `flyway/sql/V128__retain_non_scoring_walk_activities.sql`
- `flyway/sql/V129__add_activity_provider_metrics.sql`
- `flyway/sql/V130__add_grouped_swim_pace_bonus.sql`
- `flyway/sql/V131__version_garmin_cycling_match_policy.sql`
- `flyway/sql/V132__version_garmin_run_default_match_policy.sql`

## Validation

Pending implementation and focused validation. No live provider download or production backfill authorized.
