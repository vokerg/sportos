# Garmin cursor sync #248

Branch `issue-248-garmin-cursor-sync` starts at current main `fbd47e6`, after
#247 merged. Issue #248 records the maintainer's new scope and pre-edit claim;
PR #249 owns implementation. The existing queue supported only targeted day or
activity fetches; documentation now also describes explicit general sync.

## Result and invariants

Web Overview/native Home and both Providers screens have **Sync Garmin**.
The initial cursor is midnight two days ago in the connection's Garmin calendar.
The server derives a fixed inclusive window from cursor day through today;
clients submit no date, owner or cursor. Every click after completion enqueues a
fresh refresh of all eight day categories, including repeated clicks today.
An evening checkpoint yesterday therefore includes yesterday's late uploads and
steps before fetching today. Active duplicate clicks converge to one job.

Primary V147 adds cursor and immutable job-window metadata with existing forced
RLS/owner constraints and role grants intact. One day runs per fenced worker
claim; successful day completion advances job progress and the cursor in one
transaction. Re-fetching a completed cursor day or an older day changes neither
cursor date nor timestamp. A newer successful explicit day may skip older days,
as the maintainer requested. An uncompleted seed is checkpointed on first success.
Failure/cancellation/lost lease never checkpoints the affected day. Earlier
successful days survive partial multi-day failure. Retried jobs start at the
current inclusive cursor. Credential rotation/lease fencing remain unchanged.
No canonical/scoring/ledger writes were added; scoring remains explicit.

The web reusable control owns scoped feature state and uses the shared bounded
poller; the native card uses existing abortable operation/job tracking. Both
recover active work, provide manual checks, cancel/retry, and preserve server
jobs across navigation. A new web submission cancels stale completion cursor
reads. Ambiguous submissions require capability recovery before another POST.

## Validation

- Full `pnpm test` passes (database-dependent suites are skipped there by design).
- Full `pnpm typecheck`, web production build and architecture boundaries pass.
- Nine separate worker integration tests pass using non-owner API, dispatcher,
  worker-data and detail-worker roles in disposable loopback databases. They cover
  seed/checkpoint progress, fresh repeated sync, evening cursor/late steps,
  skip-ahead policy, duplicate requests, foreign ownership, API cursor denial,
  failure/cancellation, stale leases, credential rotation, retry and rate limits.
- Fresh and populated primary/detail migration gates pass through V147/V007,
  including retained fixture survival and existing day/native JSON integration.
- Native tests include explicit-only navigation, duplicate protection, repeatable
  same-day sync, active-job recovery/cancel/retry, ambiguous submission and teardown.
- Actual Safari → Angular → Nest API → Postgres queue → Node worker → Python
  helper → Garmin → separate retained detail/primary evidence → completed UI
  passed with the protected existing SDK session and ephemeral encrypted worker
  credentials. Runtime database logins were non-owner. Only disposable local
  databases were migrated; personal/production databases were untouched.
- First three-day sync took **21.067 s** from queued creation to terminal completion.
  A fresh same-day repeat took **5.980 s**. Cancel from Home reached cancelled;
  browser Retry completed in **5.425 s**. Providers submission followed by Overview
  navigation recovered active work without a duplicate POST.
- Retained 24 category heads over three days, including steps for yesterday.
  Same-day repeat preserved the cursor timestamp. Canonical activity, daily-score
  and ledger row counts remained zero in the initially empty test database.

These are observed samples, not an SLA or a before/after comparison of this new
control. Prior acquisition comparisons remain in `GARMIN_RICH_ACQUISITION.md`
(three-activity day 13.935 → 10.179 s). Native component/contract tests passed;
a physical device/simulator flow was not run for this change. Hosted production
activation and migration were not performed. No credentials, source IDs, provider
payloads, private timestamps or screenshots are committed.

## Actual inspected files

The issue claim lists the initial investigation. The list below includes follow-up
consumer/test inspection, all migrations read before selecting V147, and modified
files re-read during self-review.

- `AGENTS.md`
- `README.md`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/garmin/garmin-jobs.controller.ts`
- `apps/api/src/garmin/garmin-jobs.service.test.ts`
- `apps/api/src/garmin/garmin-jobs.service.ts`
- `apps/api/src/main.ts`
- `apps/mobile/package.json`
- `apps/mobile/src/daily/screens.tsx`
- `apps/mobile/src/providers/GarminSyncCard.tsx`
- `apps/mobile/src/providers/garmin-jobs.ts`
- `apps/mobile/src/providers/screens.tsx`
- `apps/mobile/src/providers/track-garmin-job.ts`
- `apps/mobile/src/providers/use-operation.ts`
- `apps/mobile/test/provider-controls.test.tsx`
- `apps/web/package.json`
- `apps/web/src/app/features/daily/state/garmin-day.store.ts`
- `apps/web/src/app/features/providers/data-access/garmin-sync-api.service.ts`
- `apps/web/src/app/features/providers/index.ts`
- `apps/web/src/app/features/providers/state/garmin-sync.store.test.ts`
- `apps/web/src/app/features/providers/state/garmin-sync.store.ts`
- `apps/web/src/app/features/providers/ui/garmin-sync-control.component.ts`
- `apps/web/src/app/overview-page.component.ts`
- `apps/web/src/app/provider-panel.component.ts`
- `apps/web/src/app/shared/model/garmin-job.ts`
- `apps/worker/src/garmin-job-runner.integration.test.ts`
- `apps/worker/src/garmin-job-runner.ts`
- `docs/AI_ANALYSIS.md`
- `docs/ARCHITECTURE.md`
- `docs/AUTHENTICATION.md`
- `docs/FRONTEND_ARCHITECTURE.md`
- `docs/GARMIN_RICH_ACQUISITION.md`
- `docs/GARMIN_WORKER.md`
- `docs/ROADMAP.md`
- `docs/adr/0010-garmin-activity-reconciliation.md`
- `docs/adr/0012-durable-garmin-worker-jobs.md`
- `docs/implementation/issue-246.md`
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
- `flyway/sql/V147__add_garmin_incremental_day_sync.sql`
- `package.json`
- `packages/db/src/garmin-jobs-schema.ts`
- `packages/db/src/repositories/garmin-jobs.repository.ts`
- `scripts/test-garmin-worker-db.mjs`
