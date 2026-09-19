# Canonical Activities

Activities are the human-readable training history backed directly by the account-owned canonical `activities` table. Imports and provider synchronization establish those facts first; the Activities API reads them without recalculating or modifying them.

`/activities` shows newest activities first, with inclusive `from` and `to` date filters, canonical `activityType` and `source` filters, and sport-appropriate metrics. The browser defaults to Strava and the past three months; All sources and All time are explicit choices. The quick ranges match the other date-filtered pages: 1/3/6 months, year to date, 1/3 years, All time, and Custom. Changing a date makes the range Custom. `/activity/:id` shows one canonical activity, its available metrics and notes, and a collapsible source/provenance section. A missing or foreign account ID returns the same 404.

## Boundaries

- **Activities**: canonical activity facts, duration, distance, heart rate and other imported metrics. The UI reads `activities` through `ActivitiesRepository` and account context.
- **Daily Log**: day-level facts, official scoring, ledger contributions, manual daily entry and provenance. Activities do not display or calculate day scores.
- **Performance events and Run Lab**: separately imported running achievements and performance history. Run Lab keeps its existing data source and behavior; it is not derived from this Activities UI.

## Strava run data currently retained

The Strava ingest path stores the activity date and start timestamp, provider identity, run subtype (such as treadmill or race), distance, elapsed and moving seconds, moving pace derived from moving time and distance, average speed, average and maximum heart rate, elevation gain, optional calories, and the Strava activity name in canonical `notes`. The Activities list and detail show these fields when present; detail groups time/distance, pace/terrain, and heart rate/energy, and derives stopped time only when elapsed time exceeds moving time. Durations use `m:ss` or `h:mm:ss` throughout the browser's activity readouts. Identical elapsed and moving times are not shown twice.

Some Strava fields may be present only in retained raw source data, and some list responses do not include every optional metric. The detail page offers a collapsed **Raw source JSON (advanced)** section when a source record exists. Opening it fetches and formats the retained source response for inspection; it can include location and other private source details. Cadence, splits, power, GPS tracks, and training load are outside the canonical Activities model and remain outside this MVP. The UI does not infer canonical metrics from raw provider JSON.

## API

`GET /activities` accepts optional `from`, `to` (real `YYYY-MM-DD` calendar dates, inclusive), `activityType`, `source`, `limit` (1–100, default 50), and `offset` (0–100000). Type and source must match canonical values. Sport filters are `minDistanceM` for run, bike, or swim; `paceUnderSPerKm` for run; `minAvgSpeedMps` for bike; and `swimPaceUnderSPer100m` for swim. All are positive and bounded. A sport filter without its matching `activityType` is rejected. Pace cutoffs are strict “under” comparisons; minimum distance and speed are inclusive. Rows missing the chosen metric do not match. Swim pace is converted to the canonical seconds-per-kilometre field before querying. The browser offers run pace categories under 4:00, 4:12, 4:24, and 5:00 per kilometre, plus starter bike speed, swim pace, and minimum-distance choices. Results are ordered by activity date, start time, then ID descending. The response contains `items`, `summary` (`count`, `durationS`, `distanceM` across the entire filtered result), `limit`, and `offset`. Filters are validated before querying; unknown parameters are rejected.

`GET /activities/:activityId` accepts a canonical UUID. It returns the activity's selected canonical fields and source-record ID/type when present. Raw payloads, hashes, account IDs, storage internals and provider credentials are omitted from this default response.

`GET /activities/:activityId/source` returns the linked source record's ID, source type, and retained `raw_json` for the advanced disclosure. The browser calls it only when the section is opened. It does not include source hashes, ownership fields, storage internals, or provider credentials. A missing activity, foreign activity, or activity without a linked source record receives the same 404. All Activities routes use the authenticated account's `withAccount` context and forced row-level security.

The implementation lives in `packages/db/src/repositories/activities.repository.ts`, `apps/api/src/activities/activities.controller.ts`, and `apps/web/src/app/features/activities/`. Angular separates the API contract/client, formatting and metric selection, list presenter, list page, detail page, and a page-scoped list store for request cancellation and loading state. The feature is scoped under `features/` per the frontend architecture; the existing global API base helper remains until its planned migration.

## MVP limits

The list uses bounded offset pagination; concurrent imports may shift rows between pages. Summaries include all filtered activities, including those beyond the current page. The detail view has no splits, map, GPS track, cadence, power, training-load, editing, or sport-specific deep analysis. Canonical rows without a name receive a type-based title, with no invented activity name.
