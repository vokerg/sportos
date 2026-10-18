# Historical run Activities (#154)

Maintainer requested local reconstruction from retained workbook evidence to fill
pre-provider history. Inventory found that classified daily imports already
materialize Activities; only early aggregate-only totals and record-only gaps need
new summaries. The browser's default source filter also hides workbook history.
Personal counts, dates, previews and hashes remain in private local reports.

Inspected: AGENTS.md, README.md, ARCHITECTURE.md, ROADMAP.md, AUTHENTICATION.md,
AI_ANALYSIS.md, ACTIVITIES.md, DISTANCE_LEADERBOARDS.md, FRONTEND_ARCHITECTURE.md,
ADRs 0001/0006; migration inventory and source/ownership/provider/reconciliation
DDL through V137; importer my-sport/run-db paths and import-service.ts; shared
identity conventions; database schema/ownership and activities/daily/performance/
match/leaderboard repositories, existing ownership/leaderboard integration tests;
Activities API models, list/detail UI, formatting tests and CI/package commands.

Implementation: pure per-day planner; bounded date-cursor preview/apply repository
and CLI; V138 distinct audited historical method with source/date/distance/subtype
validation; additive public boolean and explicit historical-summary labels.
No device/recorded session semantics are inferred and no scores are calculated.
See [operator policy](../HISTORICAL_RUN_ACTIVITIES.md).

Validation and local application results will be recorded before final review.
Merge requires maintainer authorization.
