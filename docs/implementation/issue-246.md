# Issue #246 implementation and validation

Branch: `issue-246-garmin-json-rich`, from main `7e8b638`. PR #244 was already
merged and no active issue claim/PR owned this work. Claim recorded on #246
before implementation. The old acquisition audit correctly described phase 1;
it is now replaced by the actual native source/feature matrix and benchmarks.

The invariant is retained evidence before projection, with owner-scoped immutable
primary/detail versions and unchanged canonical/scoring authority. Native JSON
is not represented as FIT. Primary V146 and detail V007 extend provenance only.
The original manual FIT action remains independent of automatic JSON coverage.

Validation completed locally:

- Full `pnpm test`; full TypeScript check; backend and Angular production builds.
- Domain suite: 193 tests. Python: 34 tests, with the existing credential-dependent
  opt-in test skipped. No password or browser-cookie extraction was used.
- Focused Angular Activities/Heatmap: 51 tests; web architecture boundary check.
- Mobile model/component suites and typecheck, including native source enums.
- Fresh/populated disposable primary/detail migrations; six worker role/lease/
  encrypted-session tests; two day retention/upgrade tests; native JSON integration
  across four sports, including timelines, lengths, routes and immutable scores.
- Four actual Garmin JSON bundles published through non-owner roles into
  disposable loopback databases only. Canonical rows unchanged, zero score writes
  and no original storage calls. Personal/production databases were not migrated.
- Real run and pool paired-source comparisons, single-activity and three-activity
  day benchmarks are recorded in `docs/GARMIN_RICH_ACQUISITION.md`. Responses and
  source identifiers remain private outside Git; tests use synthetic field shapes.

Known validation limits are explicit: the retained pool specimens are all 25 m;
50 m/yard pools retain conservative FIT fallback. Mixed timer transitions, incomplete
or oversized native charts and incomplete splits also retain precise fallback.
Optional absent sensors never independently cause FIT. Native total-work units
remain unmapped and the optional gap is visible. Full matrix/backend permission
checks do not imply every Garmin device/sensor combination has been live-tested.

PR #247 was subsequently squash-merged with maintainer authorization, and #246
was closed. No deployment was performed as part of that merge.

## Actual inspected files

Initial investigation files are also recorded in the issue claim. This list
includes subsequent consumer/test inspection and every existing migration read
before selecting append-only V146/V007; modified files were re-read in self-review.

- `.github/workflows/ci.yml`
- `AGENTS.md`
- `README.md`
- `apps/api/src/activities/activity-enrichment.service.test.ts`
- `apps/api/src/activities/activity-timeline.service.test.ts`
- `apps/api/src/activities/activity-timeline.service.ts`
- `apps/api/src/activities/activity-timeline.ts`
- `apps/api/src/activities/garmin-json.integration.test.ts`
- `apps/api/src/activities/running-efforts.service.test.ts`
- `apps/api/src/daily/garmin-day.integration.test.ts`
- `apps/api/src/daily/garmin-day.service.test.ts`
- `apps/api/src/heatmap/heatmap-projections.test.ts`
- `apps/api/src/heatmap/heatmap-projections.ts`
- `apps/api/src/heatmap/heatmap.controller.test.ts`
- `apps/api/src/heatmap/heatmap.controller.ts`
- `apps/mobile/src/activities/contracts.ts`
- `apps/mobile/src/activities/model.mjs`
- `apps/mobile/src/activities/screens.tsx`
- `apps/mobile/src/maps/model.mjs`
- `apps/mobile/src/performance/model.mjs`
- `apps/web/src/app/features/activities/activities-api.service.ts`
- `apps/web/src/app/features/activities/activity-detail-page.component.ts`
- `apps/web/src/app/features/activities/model/run-laps.models.ts`
- `apps/web/src/app/features/activities/model/running-efforts.models.ts`
- `apps/web/src/app/features/activities/provider-detail.view-model.ts`
- `apps/web/src/app/features/heatmap/model/heatmap.models.ts`
- `apps/web/src/app/features/heatmap/pages/heatmap-page.component.ts`
- `apps/web/src/app/features/heatmap/state/heatmap.store.test.ts`
- `apps/web/src/app/features/heatmap/state/heatmap.store.ts`
- `apps/worker/src/garmin-job-runner.ts`
- `docs/ACTIVITY_METRICS.md`
- `docs/AI_ANALYSIS.md`
- `docs/ARCHITECTURE.md`
- `docs/AUTHENTICATION.md`
- `docs/FRONTEND_ARCHITECTURE.md`
- `docs/GARMIN_DAY_FETCH.md`
- `docs/GARMIN_RICH_ACQUISITION.md`
- `docs/GARMIN_SINGLE_ACTIVITY.md`
- `docs/ROADMAP.md`
- `docs/SCORING_RULES.md`
- `docs/adr/0010-garmin-activity-reconciliation.md`
- `docs/adr/0012-durable-garmin-worker-jobs.md`
- `flyway/activity-detail-sql/V001__create_activity_provider_resource_cache.sql`
- `flyway/activity-detail-sql/V002__add_staged_garmin_resources.sql`
- `flyway/activity-detail-sql/V003__add_garmin_day_resources.sql`
- `flyway/activity-detail-sql/V004__add_activity_route_projections.sql`
- `flyway/activity-detail-sql/V005__allow_owner_scoped_garmin_workers.sql`
- `flyway/activity-detail-sql/V006__allow_garmin_worker_detail_connection.sql`
- `flyway/activity-detail-sql/V007__allow_native_garmin_json_routes.sql`
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
- `flyway/sql/V133__add_running_effort_projections.sql`
- `flyway/sql/V134__qualify_continuous_running_effort_coverage.sql`
- `flyway/sql/V135__bound_running_effort_distance_and_pause_tolerance.sql`
- `flyway/sql/V136__use_moving_time_for_swim_bonus.sql`
- `flyway/sql/V137__add_performance_reconciliation.sql`
- `flyway/sql/V138__allow_proven_historical_excel_activity_links.sql`
- `flyway/sql/V139__multiply_swim_bonus_by_completed_kilometres.sql`
- `flyway/sql/V140__add_audited_activity_distance_corrections.sql`
- `flyway/sql/V141__multiply_bike_bonus_by_completed_10km.sql`
- `flyway/sql/V142__add_mobile_auth_pkce_handoffs.sql`
- `flyway/sql/V143__add_durable_garmin_jobs.sql`
- `flyway/sql/V144__tighten_garmin_job_and_envelope_constraints.sql`
- `flyway/sql/V145__add_readonly_mcp_oauth.sql`
- `flyway/sql/V146__allow_native_garmin_json_projections.sql`
- `package.json`
- `packages/db/src/activity-metric-projector.ts`
- `packages/db/src/activity-route-projection-schema.ts`
- `packages/db/src/garmin-activity-schema.ts`
- `packages/db/src/repositories/activity-metrics.repository.ts`
- `packages/db/src/repositories/activity-route-projections.repository.ts`
- `packages/db/src/repositories/athlete-laps.repository.ts`
- `packages/db/src/repositories/athlete-swim-lengths.repository.ts`
- `packages/db/src/repositories/distance-leaderboard.repository.ts`
- `packages/db/src/repositories/garmin-activities.repository.ts`
- `packages/db/src/repositories/garmin-activity-resources.repository.ts`
- `packages/db/src/repositories/running-efforts.repository.ts`
- `packages/db/src/running-effort-projector.ts`
- `packages/domain/src/activity-metrics.ts`
- `packages/domain/src/garmin-connect-swim.test.ts`
- `packages/domain/src/garmin-connect-swim.ts`
- `packages/domain/src/garmin-connect.test.ts`
- `packages/domain/src/garmin-connect.ts`
- `packages/domain/src/index.ts`
- `packages/domain/src/running-efforts.ts`
- `packages/domain/src/swim-lengths.ts`
- `packages/garmin-runtime/src/activity-enrichment.service.ts`
- `packages/garmin-runtime/src/activity-route-projection.service.ts`
- `packages/garmin-runtime/src/activity-route-projection.ts`
- `packages/garmin-runtime/src/activity-route.ts`
- `packages/garmin-runtime/src/context.ts`
- `packages/garmin-runtime/src/garmin-auto-rich-policy.ts`
- `packages/garmin-runtime/src/garmin-day.service.ts`
- `packages/garmin-runtime/src/garmin-local-ingest.service.ts`
- `packages/garmin-runtime/src/projections.ts`
- `scripts/garmin-local.mjs`
- `scripts/test-garmin-worker-db.mjs`
- `tools/garmin/activity_bridge.py`
- `tools/garmin/benchmark_rich.py`
- `tools/garmin/extract_activity.py`
- `tools/garmin/fetch_day.py`
- `tools/garmin/rich_policy.py`
- `tools/garmin/sportos_api.py`
- `tools/garmin/test_extract_activity.py`
- `tools/garmin/test_rich_policy.py`
- `tools/garmin/test_worker_bridge.py`
- `tools/garmin/worker_bridge.py`
