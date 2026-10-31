# Average Pace / Speed trends

The Stats hub route `/stats/average-pace` replaces the former placeholder. It uses
canonical **Strava** `activities` only (not daily score totals or workbook/manual
distance entries) and supports running,
cycling, and swimming. The authenticated, account-scoped endpoint is
`GET /stats/pace-speed`.

## Calculation and filtering

- The API accepts an inclusive `from`/`to` range of at most 3,660 days,
  sport (`run`, `bike`, `swim`), and calendar bucket granularity
  (`daily`, Monday-start `weekly`, `monthly`).
- The repository reads corrected effective distance from the existing canonical
  distance-correction expression. It uses positive moving time when recorded,
  otherwise positive duration; for records without usable time it derives
  time from corrected canonical pace or speed where possible.
- The metric is a *ratio of sums*, not an arithmetic average of activity paces:
  - Run: sum(eligible seconds) × 1000 / sum(eligible metres), in s/km.
  - Swim: sum(eligible seconds) × 100 / sum(eligible metres), in s/100m.
  - Bike: sum(eligible metres) × 3.6 / sum(eligible seconds), in km/h.
- Optional activity-level threshold: **run/swim** exclude activities slower
  than the configured pace, **bike** excludes those below the configured speed.
  The running filter defaults **on** at 6:00/km; bike/swim filters are off
  initially. Each sport's threshold and checkbox setting persist in browser
  preferences and in URL controls. The threshold is selectable rather than fixed.
- Strava is the fixed source of truth for pace, speed, volume and drill-downs.
  Workbook/manual day-distance entries are excluded, including when they overlap
  a Strava recording. The API returns `source: "strava"`; clients cannot broaden it.
- Total volume includes all positive-distance canonical Strava activities in the
  bucket. Eligible volume and time include only positive-distance activities
  with valid time and passing the selected threshold. The remaining volume
  is split into **Filtered km** (excluded by the selected threshold) and
  **Missing time km** (no positive moving time, duration, pace or speed). Turning
  the filter off makes Filtered km zero; missing timing evidence remains separate.
  If no activity contributes, the metric is `null` (not zero).

## UI and investigation

The page reuses `analytics-query-state` and the Monthly Stats quick range,
local calendar dates, and grain controls. An ECharts line shows bucket pace or
speed, with stacked included/filtered/missing-time volume bars below; sparse buckets remain
gaps rather than interpolated lines. The table reports distance, activity
coverage, and opens the existing Activities list for the clipped bucket range
with `source=strava`, matching the exact source used by the report. Loaded
labels, units, periods and drill-downs stay tied to the response while draft
controls are edited. Apply can refresh an unchanged URL; invalid submissions,
replacement requests and teardown cancel pending reads.

Files inspected: `AGENTS.md`, `docs/FRONTEND_ARCHITECTURE.md`,
`docs/implementation/stats-hub.md`, `README.md`,
`apps/web/src/app/features/stats/pages/{stats-page,average-pace-page}.component.ts`,
`apps/web/src/app/monthly-stats-page.component.ts`,
`apps/web/src/app/monthly-stats-page.component.test.ts`,
`apps/web/src/app/shared/util/analytics-query-state.ts`,
`apps/web/src/app/features/activities/{activities-page.component.ts,activities-api.service.ts}`,
`apps/web/src/app/features/dynamics/{model/dynamics.models.ts,data-access/dynamics-api.service.ts}`,
`apps/web/src/app/app.routes.ts`,
`apps/api/src/{app.module.ts,query-validation.ts}`,
`apps/api/src/activities/{activities.controller.ts,activities.controller.test.ts}`,
`apps/api/src/dynamics/dynamics.controller.ts`,
`packages/db/src/{index.ts,repositories/activities.repository.ts,repositories/activity-distance-corrections.repository.ts,repositories/dynamics.repository.ts}`,
`packages/db/src/repositories/activities.repository.integration.test.ts`,
`apps/api/package.json`, `apps/web/package.json`, and root `package.json`.

## Local takeover validation (PR #230)

Additional files inspected: `apps/api/src/auth/{session.guard.ts,session.guard.test.ts}`,
`apps/web/src/app/features/rules/pages/rules-page.component.test.ts`,
`apps/web/src/app/core/config/api-base.ts`,
`packages/db/src/repositories/historical-runs.repository.ts`,
`packages/db/src/ownership-context.ts`, `docs/HISTORICAL_RUN_ACTIVITIES.md`,
`docs/LOCAL_RECOVERY.md`, `.github/workflows/ci.yml`, `packages/db/package.json`,
and `scripts/test-garmin-worker-db.mjs`.

Passed locally:

- Stats model/page/render tests (12 cases), including real Angular template
  rendering with stubbed transport/chart, loaded-result consistency, safe errors,
  Retry, empty state, URL refresh and request cancellation.
- API query/account-context and session-guard tests; API and web typechecks.
- Angular architecture guardrails and production web build.
- All primary Flyway migrations through V144 on a disposable loopback Postgres
  cluster; trends integration tests (3 cases) using `sportos_app`, verified as
  non-owner/non-superuser without RLS bypass, with forced activity RLS enabled.
  Cases cover Strava-only scope despite overlapping manual/workbook entries,
  account isolation, weighted averages, inclusive thresholds, bike/swim units,
  corrected distance, timing fallbacks and missing coverage. Synthetic fixtures
  and correction history are rolled back. The test is included in the standard
  DB integration command and uses `SPORTOS_OWNER_TEST_DATABASE_URL`.
- Read-only live local API checks for run/bike/swim and run filter on/off.
  No personal records or diagnostic values are persisted in this document.

Visual browser inspection was unavailable because the browser access host could
not be reached. Original CI passed but skipped its primary database gates due to
missing CI secrets; local non-owner integration provides evidence for this query.
No provider fetch, scoring write, schema change or deployment was performed.
