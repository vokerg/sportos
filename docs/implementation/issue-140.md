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
