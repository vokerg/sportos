# Native analytics (#193)

Inspected required baseline docs and ADR 0011; mobile auth/navigation/UI/calendar
helpers and package config; web Dynamics contracts/client and monthly-stats view
model; API dynamics controller/contracts/service. Verified current API windows
are 7/20/30/60/365, superseding older 10-day documentation. Reviewed issue,
prerequisites and absence of active claims.

Native SVG charts consume canonical monthly/rolling API values, with distance,
points and steps units, missing-data gaps and negative scores. No client business
aggregation/scoring/window calculations. Exact dates/quick ranges, metric/window/
measure selection, touch selection and accessible previous/next numeric values
are supplied. An explicit numeric series complements every chart. Monthly ledger
shows official totals, separate distance and category points; rolling score
contributions are labelled calendar-day averages, matching server semantics.
Coverage, missing dates and partial/current-day windows remain explicit. Both
light/dark palettes use native scalable text. No rich provider calls or writes.

Validation: mobile TypeScript and 29 Node tests pass, including four new analytics
cases for exact dates/catalog, signed/null/zero values, server-projected coverage
and contribution totals, privacy and SVG gap projection. Simulator/live parity
checks follow during epic QA; physical-device acceptance is not claimed.

Local follow-up: projections passed against real monthly/rolling API responses.
Pinned SVG to SDK-required 15.15.4. Date controls collapse; numeric rows page by 50;
rolling phone views cap at 366 days, monthly at 3,660. Source calculations remain
unchanged. Screen requests use the shared optional cancellation adapter from #194.
Simulator chart interaction verification remains tracked separately from source/API
validation. No physical-device pass is claimed.
