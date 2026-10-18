# Run Lab pagination (#156)

Run Lab now has one distance leaderboard. The duplicate Performance event history
filters, chart and list are removed. Original event records, backend compatibility
routes and owner-scoped provenance drill-down remain intact. Activities continues
to own workout history independently of achievements and daily scoring.

The primary SQL query counts deduplicated ranked occurrences before applying limit
and offset, so each response has a consistent total and global ranks. Requests
accept 1–200 rows and offsets 0–100,000. The UI offers 50/100/200 rows and
first/previous/next/last navigation. Applied filters are frozen for paging;
refresh/page-size changes reset to the first page. Superseded requests cancel,
failed pages can retry, and a shrinking result set triggers at most one corrective
request to its new last page. Navigation closes stale original-record detail.
There are no schema, canonical-fact, score, provider or source-data writes.

## Investigation

Inspected README.md; docs/ARCHITECTURE.md, ROADMAP.md, AUTHENTICATION.md,
AI_ANALYSIS.md, FRONTEND_ARCHITECTURE.md, ACTIVITIES.md and
DISTANCE_LEADERBOARDS.md; Run Lab component/tests; performance feature
models/data-access, leaderboard component/store/tests; API performance controller
and tests; DB leaderboard repository and integration tests. Reviewed current main,
open issues/PRs and #154/#155. Documentation still described the duplicate history
view; the affected current guides now describe the single paginated leaderboard.

Branch started from current main and fast-forwarded to #155 to retain the pending
historical Activities change. This PR is stacked on
`issue-154-historical-run-activities`; retarget after that dependency merges.

## Validation

- Root typecheck; frontend architecture boundaries and tests; production web build.
- Focused web tests (14) and API controller tests (7).
- Non-owner primary/detail database integration (8): 225 tied synthetic records,
  all pages/global ranks, stable ordering, no overlaps, out-of-range pages,
  cross-account totals and existing deduplication/reconciliation behavior.
- Read-only local API check: first three pages and last page of the real leaderboard,
  global ranks beyond 200, matching totals and no overlapping rows.

Private source material and individual historical records are excluded from this
report. No schema changes require migration validation. CI database gates depend
on configured database credentials; local non-owner integration supplies the
pagination database evidence.
