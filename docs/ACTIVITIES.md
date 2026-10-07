# Canonical Activities

Activities are the human-readable training history backed directly by the account-owned canonical `activities` table. Imports and provider synchronization establish those facts first; the Activities API reads them without recalculating or modifying them.

`/activities` shows newest activities first, with inclusive `from` and `to` date filters, canonical `activityType`, run `subtype`, and `source` filters, and sport-appropriate metrics. The browser defaults to Strava and the past three months; All sources and All time are explicit choices. The quick ranges match the other date-filtered pages: 1/3/6 months, year to date, 1/3 years, All time, and Custom. Changing a date makes the range Custom. `/activity/:id` shows one canonical activity, its available metrics and notes, and a collapsible source/provenance section. A missing or foreign account ID returns the same 404.

## Boundaries

- **Activities**: canonical activity facts, duration, distance, heart rate and other imported metrics. The UI reads `activities` through `ActivitiesRepository` and account context.
- **Daily Log**: day-level facts, official scoring, ledger contributions, manual daily entry and provenance. Activities do not display or calculate day scores.
- **Performance events and Run Lab**: separately imported running achievements and performance history. Run Lab keeps its existing data source and behavior; it is not derived from this Activities UI.

## Strava run data currently retained

The Strava ingest path stores the activity date and start timestamp, provider identity, run subtype (such as treadmill, track, outdoor, or race), distance, elapsed and moving seconds, moving pace derived from moving time and distance, average speed, average and maximum heart rate, elevation gain, optional calories, and the Strava activity name in canonical `notes`. The Activities list and detail show these fields when present; run presentation uses pace rather than speed, while bike and other speed-based activities retain average speed. Detail groups time/distance, pace/terrain, and heart rate/energy, and derives stopped time only when elapsed time exceeds moving time. Durations use `m:ss` or `h:mm:ss` throughout the browser's activity readouts. Identical elapsed and moving times are not shown twice.

Some Strava fields may be present only in retained raw source data, and some list responses do not include every optional metric. The detail page offers a collapsed **Raw source JSON (advanced)** section when a source record exists. Opening it fetches and formats the retained summary response for inspection; it can include location and other private source details.

Activity navigation now reads canonical facts and small retained-data availability
metadata only. It does **not** download rich Strava or Garmin data. Each provider
has separate **Fetch detail**, **View data**, and explicit **Refresh** controls.
Fetch first reuses a complete current cache; View reads retained data only and
never calls the provider. Refresh explicitly requests a new provider version.
The normal Strava sync remains compact-summary-only.

Strava fetch retains detailed activity, supported streams, laps and zones in the
existing separate activity-detail database. Optional unavailable resources retain
honest availability metadata. Cache versions follow the latest compact summary;
stale resources require an explicit fetch/refresh rather than fetching on view.

Garmin View shows source-specific FIT session/running-dynamics metrics with their
retained units, up to 100 bounded laps, exercise set fields, and an advanced
one-resource-at-a-time viewer. Large/unknown FIT fields remain in original/resource
storage; session/lap overview messages are bounded to 64 KiB each. Neither provider
view replaces canonical facts or calculates official scores. Provider JSON may
include private GPS and telemetry, so disclosure remains explicit.

New Garmin downloads use the opt-in **local desktop helper** from #99. Enable
`SPORTOS_GARMIN_LOCAL_FETCH_ENABLED=true` locally after `pnpm garmin:setup` and
user-initiated `pnpm garmin:login`. The helper is allowed only for the fixed legacy
account in non-production `dev-single-user` mode; it is disabled for production
and other owners regardless of the flag. The browser receives no Garmin password,
tokens, local paths, source hashes or blob keys. Hosted instances can still read
retained Garmin data without the helper or Garmin login.

A linked complete Garmin version is reused with zero Garmin requests. Without a
native link, an explicit Fetch performs one compact discovery request over UTC
start date ±1 day, capped at 100 observations, then uses the shared #97 policy.
A full page, nearby unsupported record, weak or multiple candidates requires
review and downloads no originals. The selected original is downloaded/parsed
through the bounded local extractor and checked against the requested canonical
activity again before owner-scoped retention/reconciliation. No bulk sync or rich
Strava prerequisite is introduced. Refresh preserves historical source versions.
The bridge has a 180-second deadline and at most two active requests per process;
repeat clicks for the same account/activity return a bounded conflict.

## API

`GET /activities` accepts optional `from`, `to` (real `YYYY-MM-DD` calendar dates, inclusive), `activityType`, `subtype` (`treadmill`, `track`, or `outdoor` for runs), `source`, `limit` (1–100, default 50), and `offset` (0–100000). Type, subtype, and source must match canonical values. Sport filters are `minDistanceM` for run, bike, or swim; `paceUnderSPerKm` for run; `minAvgSpeedMps` for bike; and `swimPaceUnderSPer100m` for swim. All are positive and bounded. A sport filter without its matching `activityType` is rejected. Pace cutoffs are strict “under” comparisons; minimum distance and speed are inclusive. Rows missing the chosen metric do not match. Swim pace is converted to the canonical seconds-per-kilometre field before querying. The browser offers run subtype, pace categories under 4:00, 4:12, 4:24, and 5:00 per kilometre, plus starter bike speed, swim pace, and minimum-distance choices. Results are ordered by activity date, start time, then ID descending. The response contains `items`, `summary` (`count`, `durationS`, `distanceM`, `avgDistanceM`, and run-only distance-weighted `avgPaceSPerKm` across the entire filtered result), `limit`, and `offset`. Filters are validated before querying; unknown parameters are rejected.

`GET /activities/:activityId` accepts a canonical UUID. It returns the activity's selected canonical fields and source-record ID/type when present. Raw payloads, hashes, account IDs, storage internals and provider credentials are omitted from this default response.

`GET /activities/:activityId/provider-detail` reads only a complete current retained Strava bundle; a cache miss/stale version returns 404 without refreshing credentials or calling Strava. It returns `detail`, `streams`, `laps`, and `zones` resources with availability/status metadata, plus the provider activity ID, fetch time, and whether the response was a cache hit or miss. It never returns provider credentials, connection IDs, owner IDs, hashes, or storage internals. Missing/foreign activities and activities without a Strava link receive the same 404. Provider authorization or upstream failures return a bounded service error.

`POST /activities/:activityId/provider-detail` explicitly fetches Strava detail.
The only optional body field is boolean `refresh` (default false); false reuses
current retained data, true refreshes upstream. It uses the authenticated owner
and session-bound CSRF protection.

`GET /activities/:activityId/enrichment` returns owner-scoped provider availability
only; it never reads full source payloads or calls a provider.
`GET /activities/:activityId/garmin-detail` reads the bounded Garmin overview.
`GET /activities/:activityId/garmin-detail/resource?resourceType=records&chunkIndex=0`
reads one retained detail/sets/records/laps resource (never private FIT manifests).
`POST /activities/:activityId/garmin-detail` explicitly reuses/fetches Garmin with
the same optional boolean `refresh`. IDs are canonical UUIDs, not user-selected
owners or provider connections. Missing/foreign activities use the same 404;
ambiguity, helper setup/authentication, rate limits and timeouts are safe and visible.

`GET /activities/:activityId/source` returns the linked source record's ID, source type, and retained `raw_json` for the advanced disclosure. The browser calls it only when the section is opened. It does not include source hashes, ownership fields, storage internals, or provider credentials. A missing activity, foreign activity, or activity without a linked source record receives the same 404. All Activities routes use the authenticated account's `withAccount` context and forced row-level security.

The canonical implementation lives in `packages/db/src/repositories/activities.repository.ts`, `apps/api/src/activities/activities.controller.ts`, and `apps/web/src/app/features/activities/`. Explicit provider detail uses `packages/db/src/repositories/activity-provider-resources.repository.ts`, `apps/api/src/activities/activity-provider-detail.service.ts`, and the Strava adapter in `packages/importers/src/strava-adapter.ts`. Angular separates the API contract/client, formatting and metric selection, list presenter, list page, detail page, and a page-scoped list store for request cancellation and loading state. The feature is scoped under `features/` per the frontend architecture; the existing global API base helper remains until its planned migration.

## MVP limits

The list uses bounded offset pagination; concurrent imports may shift rows between pages. Summaries include all filtered activities, including those beyond the current page. The canonical detail view still does not promote splits, GPS track, cadence, power, training load, or other provider-only fields into the SportOS activity model; those values are available only through the raw provider-detail bundle for now. There is no map/chart rendering, editing, or sport-specific deep analysis yet. Canonical rows without a name receive a type-based title, with no invented activity name.

`activity_provider_resources` resides in a separate Neon project configured by the explicit `SPORTOS_ACTIVITY_DETAIL_DATABASE_URL`. The API first resolves the canonical/provider reference and credentials in the primary project, then opens the detail project under the same account context. The cache has no cross-project foreign keys; identity and authorization remain authoritative in the primary database, and the detail rows are bounded, derived, owner-scoped, and rebuildable. The runtime and Flyway URLs must not be derived from or reuse the primary project. Run `pnpm db:migrate:activity-detail` with the separate project's schema-owner settings before starting the API.

## Garmin reconciliation foundation

Garmin is auxiliary enrichment. Primary list/detail reads include an optional
`garmin` identity/link/status descriptor while retaining the existing canonical
fields and counts. Garmin-only and ambiguous entries stay in the separate staging
API and do not appear as canonical activities. No Garmin download occurs when a
page opens. See [ADR 0010](adr/0010-garmin-activity-reconciliation.md) for the
compact ingress/review contracts, match thresholds, versioned resource storage,
reverse reconciliation and the single-activity extractor. The explicit controls
above override the earlier activity-navigation Strava fetch behavior.
