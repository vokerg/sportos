# Dynamics history, exploration and records (#271)

## Behavior

Dynamics now reads `GET /dynamics/history?to=YYYY-MM-DD` once per route instance
(or explicit Refresh data). The authenticated owner comes from the session; the
only accepted query field is a real end date between 1900 and 2100 inclusive.
The feed starts at the earliest canonical daily row and includes every calendar
day through the requested end. Web/native request the local current date, keeping
future days out of their views. Monthly and legacy rolling routes remain compatible.

The version-1 feed carries aligned date/daily/rolling numeric columns for all
seven metrics and 7/20/30/60/365-day windows, plus one shared ledger-contribution
projection and deterministic records. It contains no source payloads, storage
metadata, account identifiers, sessions, notes or credentials. Reads use existing
owner-scoped repositories and forced RLS. Daily facts and ledger components are
read in one repeatable-read transaction; the connection is released before CPU
aggregation. Imported components that cannot reconcile remain unattributed rather
than fabricating a component split. Calculated ledger rows omit unnecessary raw
source payloads from the database result; only synthetic imported totals need
retained workbook cells for attribution.

Both the single-metric and combined calculations advance running sums/counts and
subtract expired values. Persisted daily distances have two decimal places; sums
use integer hundredths so equal windows stay tied across long histories. Missing
rows stay distinct from recorded zero. Calendar averages divide by the full
window, and recorded/active-day counts remain explicit.

Web charts retain full history while date controls initialize the viewport.
Inside zoom and draggable sliders operate locally, and linked charts share the
viewport. All time uses actual available history, including history beyond the
former 3,660-day shortcut. Tables offer 50/100/200-row pages, first/last navigation,
and an independent all-history option. Heat scales are computed once per table
range/metric/window, not per page. They anchor the mean positive value at medium
intensity and reserve the strongest shade for the maximum. Zero/missing values
have no fill. The shared scale also repairs Daily and Monthly colors; Daily
explicitly clears recycled cell backgrounds when values become zero/missing.

Native Dynamics uses the same feed and server records, with local metric/window/
range changes, zoom in/out, earlier/later navigation and full history. Exact values
are paginated in blocks of 50; chart touch markers are bounded independently of
the exact numeric series. Reads refresh on focus or explicit Refresh data and
private history is kept only in screen memory. The existing legacy rolling
endpoint's phone query limit is retained for compatibility; this screen no longer
uses it.

## Record and recalculation semantics

Records cover daily values and all five rolling calendar-day averages for run,
bike, swim, steps, official total, workout points and power/bonus points. Power is
the existing `bonus` metric, not a second scoring column. Official score records
use `daily_metrics.total_points`, preserving imported/manual/calculated authority.

All-time and each calendar year's highs are keyed by window **end date**. January
windows include the relevant preceding December days. The first date wins ties.
Startup windows do not rank before a full calendar span has elapsed since the
first retained daily row. Missing dates within later spans remain a coverage
qualification; records show recorded/expected days. Today is provisional.

The web defaults to current-year versus all-time highs and offers older years.
Native shows current-year/all-time highs for its selected metric/window and daily
values. There are no month-high records.

Records are deterministic read output over current canonical daily rows, not a
second persisted score authority. Consequently, recalculating any historical date
updates its year's highs, all-time highs and any affected later window end dates
(including the next calendar year) on the next history read. Decreasing/removing a
former winner selects its actual replacement. This avoids stale materialized
maxima, expensive record maintenance inside scoring transactions, and a new
aggregation backfill/migration. Existing ledgers, immutable score snapshots,
scoring rules, provider retention and recalculation writes are unchanged.

## Performance evidence

Sanitized 3,653-day, seven-metric, five-window fixture on the development machine:

| Calculation / transport | Measurement |
| --- | --- |
| Original main's seven rolling calculations | 21,462 ms CPU wall time |
| Combined history calculation including records | about 130 ms |
| Seven responses, after linear algorithm optimization | 556 ms / 28,513,158 JSON bytes |
| Combined history response | 3,212,542 JSON bytes; 127,946 gzip bytes |

These are local synthetic calculation/payload measurements, not hosted response
latency or a Core Web Vitals measurement. Reproduce the current benchmark with
`pnpm exec tsx scripts/dynamics-benchmark.mts`. The original comparison used
`origin/main`'s contract module with exactly the same fixture, outside Git.
Compression size is illustrative; no new HTTP compression configuration is
introduced. Cold starts, database/network latency and deployment behavior remain
separate costs. Time aggregation/downsampling remains future work.

## Validation

- Focused API tests: all metrics/windows against an independent naive reference;
  exact expiry, nonzero pre-range history, gaps/zero/null, leap days, December/
  January windows, year/all-time record decreases, startup eligibility, decimal
  ties, query bounds, session-owner forwarding and one repeatable snapshot.
- Focused web tests: route controls, one history load/local reuse, cancellation/
  teardown/error privacy, full chart history and bounded table pages, stable heat
  scales, today-aware zoom indices, Daily/Monthly color behavior.
- Native model and mounted-screen tests: column validation, server record fidelity,
  local zoom/pan/range/metric/window/page changes without refetch, refresh and
  sanitized failure behavior. Native TypeScript and iOS Hermes export passed.
- Web TypeScript, hosted production build and architecture boundary checks passed.
- Existing Dynamics repository unit tests passed. Its non-owner database isolation
  integration test was skipped: no test database URL is configured in this shell.
- Chrome UI verification used a separate local hosted build with a **synthetic**
  ten-year API fixture: charts/records rendered; slider drag zoomed the timeline;
  last-page navigation exposed the earliest date; All time remained selected.
  The fixture logged one history request throughout local range/zoom/pagination.
  Browser trace tooling was unavailable, so no LCP/INP/CLS claim is made.
- The configured live local Neon hostname failed DNS lookup. Live database query
  timing/EXPLAIN and production data parity were not verified. No live writes,
  migrations, deployment, merge or physical iPhone installation were performed.

## Investigation inventory and mismatches

Inspected: AGENTS.md; README.md; docs/ARCHITECTURE.md, ROADMAP.md,
AUTHENTICATION.md, AI_ANALYSIS.md, FRONTEND_ARCHITECTURE.md; ADRs 0008/0011;
primary V002 daily numeric definitions; API Dynamics controller/service/contracts/
tests and query-validation.ts/db.provider.ts; DB Dynamics repository/unit/isolation
tests and pool.ts; web Dynamics page/chart models/client/contracts/tests,
app.routes.ts/app.config.ts, shared analytics-query-state.ts, Daily grid/color
models/tests, Monthly Stats page/color tests, WebAuthService; native analytics
screens/models/declarations/tests, native test setup, package scripts and Expo
configuration. Reviewed current main, all open issue bodies, open PRs and recent
merged PRs before claiming #271.

The old README called the first window 10 days; it is 7 days. Older roadmap/schema/
Garmin status summaries still lag later deliveries; this feature does not reopen
or implement that unrelated work. The old root Dynamics page/chart files moved
into `features/dynamics/{pages,model}` with route/test imports updated directly.
No new root compatibility shim or global transport registry was added.
