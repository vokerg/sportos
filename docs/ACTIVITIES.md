# Canonical Activities

Activities are the human-readable training history backed directly by the account-owned canonical `activities` table. Imports and provider synchronization establish those facts first; the Activities API reads them without recalculating or modifying them.

`/activities` shows newest activities first, with inclusive `from` and `to` date filters, canonical `activityType` and `source` filters, and sport-appropriate metrics. `/activity/:id` shows one canonical activity, its available metrics and notes, and a collapsible source/provenance section. A missing or foreign account ID returns the same 404.

## Boundaries

- **Activities**: canonical activity facts, duration, distance, heart rate and other imported metrics. The UI reads `activities` through `ActivitiesRepository` and account context.
- **Daily Log**: day-level facts, official scoring, ledger contributions, manual daily entry and provenance. Activities do not display or calculate day scores.
- **Performance events and Run Lab**: separately imported running achievements and performance history. Run Lab keeps its existing data source and behavior; it is not derived from this Activities UI.

## API

`GET /activities` accepts optional `from`, `to` (real `YYYY-MM-DD` calendar dates, inclusive), `activityType`, `source`, `limit` (1–100, default 50), and `offset` (0–100000). Type and source must match canonical values. Results are ordered by activity date, start time, then ID descending. The response contains `items`, `summary` (`count`, `durationS`, `distanceM` across the entire filtered result), `limit`, and `offset`. Filters are validated before querying; unknown parameters are rejected.

`GET /activities/:activityId` accepts a canonical UUID. It returns the activity's selected canonical fields and source-record ID/type when present. Raw payloads, hashes, account IDs, storage internals and provider credentials are omitted. Both routes use the authenticated account's `withAccount` context and forced row-level security.

The implementation lives in `packages/db/src/repositories/activities.repository.ts`, `apps/api/src/activities/activities.controller.ts`, and `apps/web/src/app/features/activities/`. Angular separates the API contract/client, formatting and metric selection, list presenter, list page, and detail page. The feature is scoped under `features/` per the frontend architecture; the existing global API base helper remains until its planned migration.

## MVP limits

The list uses bounded offset pagination; concurrent imports may shift rows between pages. Summaries include all filtered activities, including those beyond the current page. The detail view has no splits, map, GPS track, cadence, power, training-load, editing, or sport-specific deep analysis. Canonical rows without a name receive a type-based title, with no invented activity name.
