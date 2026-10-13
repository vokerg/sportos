# Heatmap archive validation and bounded optimization (#140)

Maintainer authorized the bounded GeoJSON optimization phase on 2026-10-13 after
live validation showed that the default All time view cannot display the archive.
Spatial/vector-tile infrastructure remains subject to evidence and a separate
storage/deployment decision.

## Baseline

On current main `75fab9c`, using both existing non-superuser `sportos_app` runtime
roles and retained data only:

- 8,262 eligible activities; 6,858 usable summary routes.
- 1,405,330 returned vertices; 29,067,807 bytes across 166 pages.
- Complete API traversal: 74.4 s; mean/min/max page 446/329/1,199 ms.
- 1,400 missing GPS, one invalid route, three skipped by API page budgets.
- Browser default All time refuses the dataset at its route/point limit.
- Auxiliary Flyway V004 was pending. Applied the existing migration; primary
  remained at V135. No source downloads, canonical or scoring writes.
- No compact route projections existed; six retained Strava stream/detail bundles
  are available for a separate explicit retained-data projection proof.
- Focused API/web suites, architecture checks, typecheck and web build passed.
- Primary heatmap integration exposed an incorrect expectation: PostgreSQL
  `jsonb_typeof` returns text `null` for JSON null, rather than SQL NULL.

## Authorized implementation scope

Evaluate compact private paginated transport and bounded in-memory geometry/density
before considering PostGIS. Preserve every included route and disjoint segment,
source precedence, currentness, owner isolation, filters and visible coverage.
Record final validation and benchmark evidence here without private GPS, hashes,
owner identifiers or provider payloads.

## Bounded GeoJSON result

- Optional lossless precision-5 transport supports 200-candidate bounded pages;
  existing GeoJSON clients keep the original 50-candidate limit and budgets.
- Incremental browser construction releases raw pages, simplifies display lines
  with a 10 m local-metre tolerance and samples each disjoint part at uniform
  80 m distance. Source sampling frequency no longer changes density intensity.
- Shared weighted density cells at 1,280/320/80 m switch at zoom 10/13.
  No road matching, spatial extension, third database or tile endpoint is added.
- Input/output, route, page, sample and cell limits remain explicit and fail
  closed; coverage is shown only after every page succeeds.
- Same archive, summary-only: 6,861 usable routes, zero budget omissions,
  1,406,479 input vertices, 294,856 display vertices, 679,667 distance samples,
  68,528 weighted cells, 75,389 GeoJSON features. Transport: 5,523,490 bytes
  in 42 pages; full traversal/construction 18.2–19.4 s, construction 1.4–1.5 s.
  Node benchmark heap after construction approximately 101–103 MiB; this is
  process heap evidence, not a browser peak-memory measurement.
- Five of six existing retained Strava bundles successfully projected as streams;
  one remained unavailable under existing privacy/geometry validation. Canonical
  activity count, ledger count, score snapshot count and daily point total stayed
  unchanged. No provider download was performed.

## Database validation

Primary heatmap and single-activity route integration tests passed with the
non-owner API role, two synthetic accounts, pagination/filter/provenance cases,
Garmin precedence and forced RLS. Use a 30 s test timeout for networked Neon
fixtures; the previous 5 s default is insufficient for serial remote statements.
Auxiliary projection integration passed for batch account isolation, idempotence,
immutable owners, DELETE denial, invalidation and source timestamp ordering.
Auxiliary fixtures now roll back, including expected SQL failures via savepoints.
Live foreign-owner reads returned zero rows in both databases, forced RLS is
enabled, and account context was cleared on pool release.

## Limitations and remaining trigger

Fresh/populated disposable-database migration matrices were not run; only the
existing V004 detail migration was applied and runtime integrations exercised.
The archive has no eligible retained Garmin-only FIT projection, so that positive
case uses sanitized unit coverage; real mixed Strava quality is checked separately.
No formal browser peak-memory/frame-rate profiler result is claimed.
Spatial/vector tiles remain conditional: the present archive now fits the bounded
renderer, so this change does not justify new spatial storage or infrastructure.

## Mixed retained-source validation and browser proof

After explicitly projecting the six retained bundles (no network): 6,856 summary
routes + five streams routes, 1,414,399 input vertices, 294,824 display vertices,
68,533 density cells, 75,394 features, 5,538,278 transport bytes. Complete
traversal/construction took 21.5 s (construction 1.5 s); benchmark process heap
103 MiB. All-time rendered successfully in Chrome with correct coverage; zoom
controls, regional density, street lines and filter/empty/reset workflows are
checked through the browser. No private screenshot or GPS is committed.

Increasing the compact candidate page required increasing every auxiliary batch
bound to 200 and the metadata-only row cap to 400 (streams + detail per route).
Integration covers a full 200-route/400-resource page and its foreign-owner
negative, preventing silent rich-to-summary fallback from a leftover smaller cap.

## Reproduce

With the local API running in its existing `dev-single-user` mode on port 3010,
run `pnpm heatmap:benchmark`. The read-only operator script consumes exactly the
compact feed and pure browser dataset builder, checks duplicate routes/private
cache policy/pagination, and prints only aggregate counts, bytes, timings and Node
heap. It never accepts an owner, downloads provider data, writes cache/facts,
persists route geometry or prints coordinates/identifiers. Normal authenticated
API enforcement still applies; this script does not bootstrap a hosted session.
