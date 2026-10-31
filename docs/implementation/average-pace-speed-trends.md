# Average Pace / Speed trends

The Stats hub route `/stats/average-pace` replaces the former placeholder. It uses
canonical `activities` only (not daily score totals) and supports running,
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
- Total volume includes all positive-distance canonical activities in the
  bucket. Eligible volume and time include only positive-distance activities
  with valid time and passing the selected threshold. The remaining volume
  is displayed as **Not used**, including slow and unrateable records.
  If no activity contributes, the metric is `null` (not zero).

## UI and investigation

The page reuses `analytics-query-state` and the Monthly Stats quick range,
local calendar dates, and grain controls. An ECharts line shows bucket pace or
speed, with stacked included/not-used volume bars below; sparse buckets remain
gaps rather than interpolated lines. The table reports distance, activity
coverage, and opens the existing Activities list for the clipped bucket range
with `source=all`, without silently filtering out any provider.

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

Validation added: API query/owner-context tests, model chart/bucket tests,
Angular component tests, and an optional owner-scoped database integration test.
The latter uses `SPORTOS_OWNER_TEST_DATABASE_URL`. Browser validation against
real personal training history is intentionally not performed by a remote agent.
