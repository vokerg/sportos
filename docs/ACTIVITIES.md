# Canonical Activities

Activities are the human-readable training history backed directly by the account-owned canonical `activities` table. Imports and provider synchronization establish those facts first; the Activities API reads them without recalculating or modifying them.

`/activities` shows newest activities first, with inclusive `from` and `to` date filters, canonical `activityType`, run `subtype`, and `source` filters, and sport-appropriate metrics. The browser defaults to Strava and the past three months; All sources and All time are explicit choices. The quick ranges match the other date-filtered pages: 1/3/6 months, year to date, 1/3 years, All time, and Custom. Changing a date makes the range Custom. `/activity/:id` shows one canonical activity, its available metrics and notes, and a collapsible source/provenance section. A missing or foreign account ID returns the same 404.

## Boundaries

- **Activities**: canonical activity facts, duration, distance, heart rate and other imported metrics. The UI reads `activities` through `ActivitiesRepository` and account context.
- **Daily Log**: day-level facts, official scoring, ledger contributions, manual daily entry and provenance. Activities do not display or calculate day scores.
- **Performance events and Run Lab**: separately imported running achievements and performance history. Run Lab keeps its existing data source and behavior; it is not derived from this Activities UI.

## Walking history

Strava Walk summaries are retained as type `walk`, with a Walk filter and normal
activity/source/detail views. Explicit Garmin Fetch supports walking linkage.
Walks contribute no activity points or performance events and are excluded from
scored daily aggregates and workout completeness requirements. Garmin all-day
steps remain unchanged. See [walking policy and backfill](WALKING_ACTIVITIES.md).

## Strava run data currently retained

The Strava ingest path stores the activity date and start timestamp, provider identity, run subtype (such as treadmill, track, outdoor, or race), distance, elapsed and moving seconds, moving pace derived from moving time and distance, average speed, average and maximum heart rate, elevation gain, optional calories, and the Strava activity name in canonical `notes`. The Activities list and detail show these fields when present; run presentation uses pace rather than speed, while bike and other speed-based activities retain average speed. Detail leads with a sport-specific summary: runs show distance, pace and moving time; bikes show distance, average speed and moving time; swims show metres, pace per 100 m and elapsed time. Missing moving time falls back to explicitly labeled elapsed time. Secondary groups retain heart rate, terrain, dynamics and training metrics, and derive stopped time only when elapsed time exceeds moving time. Durations use `m:ss` or `h:mm:ss` throughout the browser's activity readouts. Identical elapsed and moving times are not shown twice.

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

`GET /activities/:activityId/provider-detail` reads only a complete current retained Strava bundle; a cache miss/stale version returns 404 without refreshing credentials or calling Strava. It returns `detail`, `streams`, `laps`, and `zones` resources with availability/status metadata, plus the provider activity ID, fetch time, and cache-hit status. It never returns provider credentials, connection IDs, owner IDs, hashes, or storage internals. Missing/foreign activities and activities without a Strava link receive the same 404. The explicit POST may return a bounded provider authorization or upstream error; the GET never loads credentials.

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

The canonical implementation lives in `packages/db/src/repositories/activities.repository.ts`, `apps/api/src/activities/activities.controller.ts`, and `apps/web/src/app/features/activities/`. Explicit provider detail uses `packages/db/src/repositories/activity-provider-resources.repository.ts`, `apps/api/src/activities/activity-provider-detail.service.ts`, and the Strava adapter in `packages/importers/src/strava-adapter.ts`. Angular separates the API contract/client, formatting and metric selection, list presenter, list page, detail page, a page-scoped list store, and `state/activity-detail.store.ts` for cancellation and independent detail/fetch/resource state. The feature is scoped under `features/` per the frontend architecture; the feature HTTP client injects `core/config/api-base` directly.

## Activity route API (summary fallback and retained projections)

`GET /activities/:activityId/map` is authenticated and read-only. Given a
canonical activity UUID, it reads the most recent available **linked Strava**
snapshot's `raw_json.map.summary_polyline` in the primary database, with
the authenticated account's forced-RLS context. The trusted chain is
`activities` → `provider_activity_links` → Strava
`provider_connections` → latest linked `source_records`. A workbook-origin
canonical activity may therefore show a linked Strava route. A source record
without a valid available link is not evidence for this endpoint. Foreign and
unknown UUIDs return the same 404.

A valid precision-5 encoded summary returns HTTP 200 with this contract:

```json
{
  "status": "available",
  "source": "strava",
  "resolution": "summary",
  "geometry": { "type": "LineString", "coordinates": [[-120.2, 38.5], [-120.95, 40.7]] },
  "bounds": [-120.95, 38.5, -120.2, 40.7],
  "pointCount": 2
}
```

GeoJSON coordinates use `[longitude, latitude]` and bounds use
`[west, south, east, north]`. If there is no eligible Strava link, the route
is `{"status":"unavailable","reason":"no_gps"}`; if the current compact
summary has no polyline (including when truncated during retention), it is
`summary_polyline_missing`; malformed, degenerate, out-of-range, or
pathological inputs yield `invalid_geometry`. These are 200 responses and
should be shown as unavailable states, **not** as blank maps. Bad UUIDs are
400; inaccessible/nonexistent activities are 404.

The decoder allows at most 30,000 encoded characters, 5,000 points, and
200 KB of serialized coordinates; routes require at least two distinct
points. Summary geometry is approximate, not a high-resolution GPS track.
The GET does no writes, provider requests, full rich-data materialization or
provider traffic and exposes no raw source fields, credentials, hashes or owner
internals. It reads one compact owner-scoped projection row in the existing
**auxiliary activity-detail database** only after primary canonical/link lookup.
It cannot restore geometry discarded at ingestion. GPS locations are private
and stay behind account authentication.

## Heatmap route feed (#137)

`GET /heatmap/routes` is an authenticated, read-only bulk route endpoint for
the personal heatmap UI. The primary database supplies owner-scoped trusted
Strava summaries and (only when no available Strava link exists) current linked
Garmin identities. The existing auxiliary activity-detail database optionally
supplies already-retained, compact high-resolution route projections in **batch**.
No provider network requests, rich-resource payload reads or on-demand rebuilds
occur during heatmap GET. Missing/down auxiliary storage degrades to available
Strava summary geometry. Routes are never publicly cached
(`Cache-Control: private, no-store`); GPS remains private and account-scoped.

Optional query parameters: inclusive `from` and `to` (real `YYYY-MM-DD`
dates), canonical `activityType` (the same enumerated values as `GET /activities`),
`limit` (1–50, default 25), optional `encoding=polyline5` (permits up to
200 candidates), and an opaque `cursor` returned by the previous page.
Unknown/duplicate-style array parameters, bad cursors and malformed filters
return 400. There is **no default date cutoff**; paginate to cover all time.
Compact encoding returns `geometry: {type, polylines}` with one precision-5
latitude-first encoded line per disjoint part; decoding reproduces the existing
display coordinates. Compact pages cap geometry at 1,000,000 points and 1,600,000
serialized characters; existing GeoJSON mode retains its smaller budgets.
No route resampling occurs on the server.

Ordering is deterministic by `activity_date DESC, id DESC`, with an exclusive
cursor on the last **examined eligible** canonical activity. Clients must
retain their original filters while advancing the cursor and stop when
`hasMore: false` (not when an `items` page happens to be empty).

A Strava candidate qualifies only if it has an **available linked Strava connection**
and a normalized, Strava-native latest linked source record matching the canonical
activity and native ID. Workbook-origin activities with such links qualify. A
Garmin-only candidate qualifies when a canonical activity has a linked Garmin
identity and **no available linked Strava identity**. An available Strava link,
even if its summary is missing, malformed or untrusted, **blocks Garmin FIT
substitution**. Multiple links never duplicate a canonical route. The trusted
Strava summary selector is shared with the single-activity fallback.

Example response (illustrative coordinates):

```json
{
  "items": [
    {
      "activityId": "11111111-1111-4111-8111-111111111111",
      "date": "2026-05-01",
      "sport": "run",
      "source": "strava",
      "resolution": "summary",
      "geometry": { "type": "LineString", "coordinates": [[-120.2, 38.5], [-120.95, 40.7]] }
    }
  ],
  "limit": 25,
  "nextCursor": null,
  "hasMore": false,
  "partial": false,
  "coverage": {
    "eligibleScanned": 1,
    "usable": 1,
    "missingGps": 0,
    "invalidGeometry": 0,
    "budgetExceeded": 0,
    "quality": { "summary": 1, "streams": 0, "detail": 0, "fit": 0 }
  }
}
```

`coverage` is **page-scoped**, not an assertion of all-time coverage:
`eligibleScanned` counts linked Strava/eligible Garmin canonical candidates examined on this page;
`usable` counts returned routes. Missing/invalid/degenerate geometry is
skipped and counted, and a geometry-budget exclusion is separately counted.
`partial` is true if more pages exist **or** any scanned candidate was omitted.
Missing/unlinked Strava coverage cannot be inferred as full archive GPS
coverage from this endpoint alone. Page size and payload are bounded to
50 candidates, 15,000 total decoded points, and 400,000 serialized GeoJSON
geometry characters; each summary retains the stricter per-route decoder
limits (30,000 encoded characters, 5,000 points, 200 KB coordinate JSON).
Already-retained high-resolution routes are constrained to 3,000 points and
50 disjoint segments each. If a rich Strava route exceeds the remaining page
geometry budget, a valid smaller Strava summary is used instead when it fits.
`quality` contains per-page counts of delivered
summary, streams, detail and FIT routes; only delivered (not omitted) routes
are counted. Rich geometry uses `LineString` or `MultiLineString` without
interpolating across gaps.
No truncated geometry is ever returned. An omitted route advances the cursor
to avoid infinite retries; use smaller pages if a budget omission is reported.
Pagination is stable for an unchanged dataset; a concurrent Strava
reconciliation or activity-date correction may change subsequent pages.
No account IDs, raw source JSON, hashes, token/envelope data or auxiliary
storage identifiers appear in responses. Primary activity, source identity and
current version are read with `DbProvider.withAccount` and forced RLS. One
auxiliary owner-scoped batch reads at most 50 compact projections plus bounded,
metadata-only current Strava resource timestamps/versions or Garmin FIT
manifest presence, never N activity-map calls. The projection source reference,
resource hash format, algorithm version, state and source version must match
primary identity/currentness; Strava additionally requires a valid
privacy-visible summary and exact latest normalized source identity. A refreshed
same-version Strava bundle invalidates old projection evidence by timestamp.
Corrupt/stale/foreign rows are ignored. Auxiliary failures are safe summary
fallbacks; Garmin-only rows with no usable projection remain missing-GPS.

## Higher-resolution route projections (#128)

The **existing** MapLibre view automatically switches from Strava summary to a
current, compact retained route. `resolution` is `streams` (Strava `latlng`
stream), `detail` (Strava detailed `map.polyline`), `fit` (linked Garmin FIT),
or `summary` (compact Strava). It accepts `LineString` or `MultiLineString`
GeoJSON and bounds `[west,south,east,north]`, with honest provider labeling.
Disjoint route sections are separate lines; no artificial bridge is drawn
across missing points, implausible jumps or long recording gaps.

`POST /activities/:activityId/map/reprocess` accepts exactly an empty body and
rebuilds from **already retained** detail on the authenticated account. It
returns `routeProjection.status` as `projected`, `already_current`, `stale`, or
`unavailable`. It never contacts Strava/Garmin or downloads original FIT. Normal
GET/navigation never triggers reprocessing, jobs or any data writes. Existing
explicit Strava and Garmin Fetch/Refresh can update the projection, and the
browser refreshes the map after successful Fetch; opening View data does not.
No automatic historical backfill or provider prefetch is performed.

The projected geometry is stored in auxiliary Flyway **V004** under forced RLS
with a non-owner `sportos_app` role, immutable owner IDs, and no cross-database
foreign keys. `owner_id`, canonical UUID, provider, resolution, source reference,
source version, resource hash, algorithm version, status, bounds, point count,
and update/fetch times are kept, plus at most 3,000 compressed points encoded
as a bounded array of precision-5 polylines. No raw FIT, stream JSON, or map
raster tiles are duplicated. Primary source links/current version remain
responsible for identity and ownership; reads decline stale provider versions
and fall back to valid Strava summary. Failed/partial projection attempts never
replace canonical facts or scores. Manual retained reprocess is idempotent.

**Privacy rule:** richer Strava evidence may be used only if the compact
summary route is valid, and richer endpoints are clipped to summary-visible
start/end vicinity. Garmin FIT must **never** be substituted for any activity
with an available Strava provider link, even when its compact route is absent
or invalid; this deliberately favors no map over potentially bypassing Strava
redaction. Garmin FIT is eligible only for linked Garmin activities with **no**
available Strava link. No reconstruction from start/finish totals or workout
metadata is allowed. For maximum privacy, summary visibility decisions should
remain authoritative: clipping endpoints is conservative but cannot prove that
all intermediary locations have the same provider privacy treatment.

Deployment requires applying auxiliary V004 first: `pnpm db:migrate:activity-detail`
with the separate project's schema-owner settings; no backfill or production
migration is initiated automatically. Reprocess one activity explicitly after
migration. A missing V004 or failed auxiliary projection lookup gracefully falls back
to the retained Strava compact summary (when available), rather than breaking
the previous summary-map GET. Successful explicit provider Fetch/Refresh remains
authoritative even if optional projection fails; callers may retry the retained
reprocess endpoint after restoring the auxiliary migration. A same-version
Strava resource refresh invalidates an older projection through small retained
metadata (availability, source version and fetch timestamp), without loading
streams on normal GET.

## Activity detail map (#127)

The activity page requests `GET /activities/:activityId/map` after its
canonical detail succeeds. Its read-only route request is independently
cancelled on navigation, and supports an explicit retry on server/network error.
An `available` response renders a responsive MapLibre GL map with a route
line, fitted bounds (48px padding, max zoom 15), basic zoom/pan controls,
and green start / red finish markers (one marker if start equals finish).
The source/resolution label comes from the map API and can represent future
Strava stream/detail and Garmin FIT projections without changing navigation.

Indoor/manual activities, missing Strava GPS summary, invalid geometry, and
missing links show an explanation instead of an empty map. Slow responses,
404/error and new activity navigation cannot leave a stale track visible.
Opening the activity triggers no Strava/Garmin rich downloads, scoring writes,
or route projection writes. The feature reads the same owner-scoped endpoint
as #126.

**Map assets / third parties:** MapLibre GL JS **5.12.0** JS and CSS are
loaded lazily from the version-pinned jsDelivr CDN only when GPS is available,
with no additional pnpm dependencies or lockfile changes. Route base tiles
are OpenStreetMap public raster tiles with MapLibre attribution. Browser
tile requests reveal viewed areas and IP metadata to the tile provider;
CDN requests also disclose basic browser network metadata. The application
does not upload a provider route JSON or source evidence to either service.
The public OSM tile server is best-effort and intended only for light usage;
heavy/production use should configure a properly licensed hosted basemap.
Failures to load JS or CSS expose a retry and discard failed assets; the map initializes only after both load. Tile failures
produce a warning without dropping retained route evidence. CSP deployments
must permit these pinned CDN assets, raster tile origin, and MapLibre's
`blob:` worker source, or replace the bundle with self-hosted assets.
See the [MapLibre browser quickstart](https://maplibre.org/maplibre-gl-js/docs/)
and [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## MVP limits

The list uses bounded offset pagination; concurrent imports may shift rows between pages. Summaries include all filtered activities, including those beyond the current page. The canonical detail view adds separate normalized provider activity-level metrics and read-only selections ([catalog and offline backfill](ACTIVITY_METRICS.md)), while splits, GPS tracks and time series remain retained resources; source-specific Garmin session/lap/sets and selected Strava detail values are displayed separately, while streams and unknown fields remain available through explicit advanced disclosures. The route API supplies read-only GeoJSON, now displayed through the activity detail's MapLibre map. Route editing, pace/HR overlays, and sport-specific deep analysis are not implemented. Canonical rows without a name receive a type-based title, with no invented activity name.

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

## Compact strength evidence

V126 adds an immutable primary strength summary for retained activity versions.
Matched workout detail shows working sets, recorded entries, labeled exercises,
warm-ups, rest and unknown counts alongside the separate original Garmin set
disclosure. Explicit daily recalculation can use complete linked summaries;
retention and page navigation never change scores. See
[scoring source policy](SCORING_RULES.md#retained-garmin-recalculation-108).

## Normalized provider observations (#112)

Primary V129 adds independent versioned Strava/Garmin scalar observations and
per-provider processing checkpoints. List badges separate linkage, raw retention,
normalization, partial coverage, failures and stale versions. Detail comparisons
show the existing canonical selection and provider values side by side: e.g.
Strava 10.2 km and Garmin 10 km, with canonical distance still Strava's.
Metric provenance exposes safe projection UUIDs, fields, units and derivation.
Normal pages read primary projections without loading raw provider JSON.

Fetch/Refresh/cache reuse and explicit **Normalize retained data** process
available evidence; normalization alone never contacts a provider or changes
scores. Historical raw coverage remains explicitly unknown until inspected.
Compact-only older history reports partial coverage. Completed inspection can
have zero optional values. Pending Garmin identities remain pending.
See [metric catalog, versions and operator backfill](ACTIVITY_METRICS.md) for
`POST /activities/:id/metrics/reprocess`, authority, missing-value semantics,
retained-only cursor batches and deployment/validation requirements.

## Activity presentation (#118)

Activity list cards and detail summaries prioritize each sport's key metrics,
with blue run, green ride and cyan swim accents. Kilometres display at most one
decimal; swimming distances remain whole metres. Summary values retain source
labels, primary authority and explicit read-only fallback status. Meaningful
provider differences remain separate even if rounding produces the same display
text; exact observations are available in advanced normalized provenance.
Canonical-only fields join the secondary detail groups, so stopped time no longer
appears as a standalone first card. Highlighted fields are not repeated there.
Small screens stack summary metrics vertically. Missing metrics are omitted from
the summary without deriving replacements, while missing comparison observations
remain visible in the secondary groups. Display formatting never changes stored
facts, provider selection, matching tolerances, official points or fetch behavior.

The activity list offers **Cards** and **Compact** views. Cards remain the default;
`view=compact` preserves a single table row per activity across filters, paging,
reload and browser back navigation. Compact columns show date/start, activity,
distance, pace/speed, time, average heart rate, ascent, provider icons. The redundant Source column is omitted. Time
follows the sport summary: moving time where available for runs/rides, elapsed
for swims; its hover/accessibility label identifies the basis. Missing values
show a dash. Activity links open the existing detail page. The table scrolls
horizontally on small screens and retains one row per activity.

Activity cards and the compact table reuse Daily's Strava/Garmin marks. Only
linked providers get an icon. An outlined icon with **S** means summary only; a
filled icon with **✓** means retained detail; **?** means detail coverage has not
been checked; **!** flags stale/failed processing. A compact legend, hover text
and screen-reader labels explain the markers. Detail retention is independent of
normalization status and does not certify every optional resource is complete.
Icons read existing compact API metadata and never query rich resources or fetch.
The redundant card source text and table Source column are omitted. Expanded
provider diagnostics on the single activity page retain counts, dates and
processing information.
Switching views reuses loaded activity results and does not fetch provider data.


## Garmin run labels and filters (#120)

For a linked Strava run whose canonical subtype is default outdoor, unknown or
missing, current compact Garmin metadata supplies `runClassification` with
`subtype` and `source: garmin`. Only explicit `track`, `treadmill` or `outdoor`
values qualify. Garmin names, GPS absence and arbitrary raw fields never classify
a run. Explicit canonical treadmill/track/race and manual/workbook subtypes remain
unchanged. The activity list, detail and Daily training sessions use this auxiliary
classification; run subtype filters and filtered totals use the same expression.
Ordinary outdoor runs display **Run**; special types display **Run · Track** or
**Run · Treadmill**. Other sports retain their subtype labels.

Existing retained links receive this projection immediately, including historical
runs; no provider download, re-import, canonical subtype rewrite or scoring
backfill is needed. Classification is presentation metadata and does not change
canonical metrics, exports, scoring inputs, daily aggregates, ledgers or snapshots.
Unlinking removes the auxiliary classification; current Garmin summary changes
can update it while preserving the established canonical UUID.

For pending retained runs, after applying primary V132:

```bash
pnpm garmin:reconcile -- --all --runs-only
pnpm garmin:reconcile -- --all --runs-only --apply
```

The first command previews; the second explicitly reconciles only runs under the
existing owner lock. Both use the fixed legacy account, bounded batches and the
non-owner app role. No provider calls or score writes occur. Policy v5 permits a
Garmin indoor/treadmill versus Strava default-outdoor disagreement only with UTC
start and positive elapsed durations within two seconds, positive distances
within max(25 m, 1%), no conflicting moving time and exactly one plausible
candidate. An explicit canonical subtype conflict, manual/workbook outdoor,
missing distance or ambiguous candidates still prevents automatic pairing.

Daily Log now shows compact accessible Strava/Garmin source icons instead of the
Authority column. Strava means an activity sourced from Strava or an available
Strava link. Garmin means a linked retained activity, an available retained
Connect day category or a CSV observation for that date. Linked activities use
the canonical activity date; no timezone is guessed for unlinked identities.
Failed-only, absent and unavailable day evidence does not add an icon. Icons
report evidence coverage, not score authority or complete rich-resource coverage.
Score authority remains available in the day workspace and canonical export.

## Running best efforts (#122)

Run detail adds a compact per-distance Strava/Garmin comparison with explicit Estimated, Calculated, Unavailable, Stale and Failed states. **Calculate retained efforts** reads retained evidence only; selective Fetch Strava detail can upgrade estimates. GET never processes streams/FIT or contacts a provider. See [policy, bounds, persistence and backfill](RUNNING_EFFORTS.md).


Run comparison metrics display average speed as **Average pace** and maximum
speed as **Fastest pace**, in min/km. Native pace is preferred per provider, with
speed converted only to fill missing pace evidence; duplicate average rows are
merged without modifying authority or raw provenance. Retained Garmin session
and lap speed fields also use pace for runs when native units are m/s. Cycling
comparisons retain km/h. Unavailable best-effort targets are hidden when neither
provider has a current calculated/estimated result; a one-provider result remains
visible, with a dash for the missing provider. Empty/stale/failed states preserve
reprocessing and diagnostics without an unavailable-only catalog.

## Expanded activity map and compact summary (#135)

Activity detail combines its heading and key metrics above the embedded GPS map;
secondary metrics remain below it. **Open full-page map** opens
`/activity/:id/map`, which fills the viewport with the same retained route,
provider/resolution label, pan/zoom controls and map attribution. **Back to
activity** returns to the detail page. Direct links use the authenticated shell
and existing owner-scoped canonical/map GETs, with loading, missing, unavailable
and retry states. This view does not fetch provider resources or check detail coverage.

Metric values shared by Strava and Garmin within the existing display tolerances
appear once without redundant provider labels, both in the summary and secondary
metrics. Different values and single-source values keep their labels. Canonical
priority, fallback notices and advanced provenance remain available; no metric
normalization, official facts or scoring behavior changes.

## Personal heatmap UI (#138)

The authenticated **Heatmap** navigation tab opens lazy route `/heatmap`. Its
feature-sliced implementation is under `apps/web/src/app/features/heatmap/`
(page, account-session HTTP data access, cancellable paginated store, pure GPS
sampling/GeoJSON, and MapLibre style). It uses the existing `GET /heatmap/routes`
from #137, defaulting to **all time and all eligible canonical sports**; users
can restrict the sport and date range without downloading from providers.

- The page reads every page (200 candidates/request with compact precision-5
  transport, stable cursors); page counts
  and missing/invalid/budget-skipped route coverage plus summary/streams/detail/FIT
  quality counts are accumulated and shown.
  A failed or cancelled page cannot expose a partial map. The browser caps
  input at 15,000 routes / 3,000,000 original GPS points / 100 pages,
  and output at 400,000 display vertices / 180,000 weighted density cells /
  3,000,000 uniform-distance samples. Each route remains bounded to 5,000
  vertices / 50 parts. Pages are consumed incrementally so raw archive geometry
  is released instead of retained alongside the rendered map. If exceeded,
  it refuses the dataset and prompts
  narrower filters, rather than suggesting that a partial view is complete.
- The style adapts `vokerg/heatmap/apps/web/src/app/map-style.ts`'s
  **heatmap-halo**, **heatmap-core**, **route-glow**, and **route-core** MapLibre
  layers to private in-memory GeoJSON. Low zoom conveys repeated corridors;
  higher zoom resolves individual tracks. Geometry sampling adapts
  `vokerg/heatmap/apps/api/src/db/file-store.ts`'s
  distance interpolation with an explicit bounded output. Uniform 80 m samples
  prevent richer streams from artificially brightening the same distance. Samples
  merge into shared weighted cells at 1,280/320/80 m, selected at zoom
  below 10 / 10–13 / above 13. Street-scale lines preserve endpoints and turns
  using a 10 m local-metre display simplification tolerance. Each LineString or
  MultiLineString *part* is sampled separately, without interpolating across
  recording gaps. Sparse Strava summaries remain **approximate**; interpolation
  never reconstructs streets or the original high-resolution GPS.
- The page uses the same lazy, version-pinned MapLibre bundle and OSM raster
  tile/attribution convention as activity maps, now via
  `apps/web/src/app/shared/util/maplibre-loader.ts`. GPS GeoJSON is given to
  MapLibre as an in-memory source only, not sent to OSM or public tile servers,
  persisted in browser storage, or cached as a public response. Viewing it
  makes no Garmin/Strava requests. The rendered bounds derive from valid GPS,
  with an empty/error state rather than a fabricated geographic center.
- This is a browser GeoJSON renderer, **not** the separate Heatmap Fastify app,
  GPX importer, local JSON storage, PostGIS/MVT tile server, or separate auth.
  #139 reuses current retained high-resolution projections when present;
  #140's maintainer-authorized bounded optimization displays the current archive
  without spatial infrastructure. PostGIS/vector tiles remain conditional on
  evidence and a separate deployment/storage decision. See the
  [real archive validation report](implementation/issue-140.md).

Relevant tests: `heatmap-geometry.test.ts`, `heatmap-style.test.ts`,
`heatmap.store.test.ts`, and `heatmap-page.component.test.ts`.
