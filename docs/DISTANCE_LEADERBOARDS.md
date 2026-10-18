# Distance leaderboards and local reconciliation (#151)

Run Lab's distance leaderboard combines original Excel achievements with current
calculated Strava moving-time windows and Garmin timer-active fallback evidence.
Targets are 5/10/15/20/21.0975/25/42.195 km. Excel half-marathon rows retain their
original 21,100 m measurement; only their target identity is normalized. Historical
12 km rows remain stored and inspectable but never enter the new catalog.

Apply primary V137 before using the leaderboard/reconciliation endpoints. Effort
algorithm **v5** adds marathon to the existing v4 pause/distance-qualified algorithm;
older projections are stale until explicitly reprocessed. No new detail migration
is required. Existing Fetch/Refresh and Calculate retained efforts publish compact
results; the next leaderboard read reflects them without provider requests.

`GET /performance/leaderboard?distanceM=5000&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=100&offset=0`
reads owner-scoped primary metadata only. Limit is 1–200 (default 100); offset is
0–100,000 (default 0). The response includes `total`, `limit`, and `offset`.
Counting and pagination happen after activity/target deduplication in the same
query; ranks remain global across pages. Range is optional and
bounded to 36,600 days when both dates are present. Default is all dates/5 km.
One activity/target ranks once, ordered by duration, date and stable identifier.
Original Excel time wins over current calculated Strava, then calculated Garmin.
Other original/measured evidence remains visible as alternatives (first 20 per row, with an explicit total; all original events remain inspectable). Repeated Excel
achievements linked to one activity/target prefer the fastest historical time.
Unlinked Excel achievements remain independent historical records. No provider
whole-run performance event or summary estimate enters this ranking. Calculated
windows exclude pauses and are **not certified race PRs**; historical Excel timing
semantics may differ. Coverage counts overlap and never certify archive completeness.

Run Lab has one results table: the distance leaderboard. First/previous/next/last
controls and 50/100/200 rows per page replace the former 200-result cutoff. Applying
filters or changing page size returns to the first page. Paging uses the last
applied filters and cancels superseded requests. Original Excel provenance remains
available through Inspect Excel / Inspect original; there is no separate event
history table or chart. Original records and their detail API remain retained.

## Running workbook export layouts

The running-record importer uses verified layouts rather than assuming every tab
has time/date in columns A/B. The combined helper view can have distance/time/date
in A/B/C. Only explicit supported distances are normalized; a rounded marathon
helper value requires an exact matching date/time in the dedicated marathon tab.
Google's XLSX export can sanitize the half-marathon tab `1/2` to `12`. It is treated
as half marathon only when all valid rows match explicitly 21.1 km-labelled rows
in the combined view. A genuine standalone 12 km sheet retains its old semantics
and remains excluded from the leaderboard.

Exact duplicate helper views share one achievement while retaining every original
row and its provenance link. Distinct helper evidence remains a separate original
achievement. Identical independent rows within a primary sheet are preserved;
ambiguous helper-to-original identity stays raw with a warning. Physical row
addresses are retained, including leading/interior blank rows. Existing nonblank
row-hash identities stay stable across re-imports. Parser metadata records version
2. If the same source identity was previously normalized to another date, distance
or time, import fails with `RUN_RECORD_NORMALIZATION_CONFLICT`; existing facts are
never silently reinterpreted. An explicit audited repair would be separate work.

## Local inventory and reconciliation

Use the non-owner `sportos_app` primary runtime URL in `.env`. The explicit owner
is a trusted local operator argument; browsers never choose owners. Keep reports,
cursors and source material outside Git. Batch output contains aggregate counts;
individual review output includes private dates/metrics and safe activity UUIDs.

```bash
# One read-only batch; default 25, maximum 100.
pnpm performance:reconcile -- --owner ACCOUNT_UUID --limit 25
# Inspect individual candidate scores, dates, distances, paces and reasons.
pnpm performance:reconcile -- --owner ACCOUNT_UUID --event EVENT_UUID
# Apply automatic decisions; resume using the returned nextCursor.
pnpm performance:reconcile -- --owner ACCOUNT_UUID --limit 25 --apply
pnpm performance:reconcile -- --owner ACCOUNT_UUID --limit 25 --cursor LAST_UUID --apply
# Explicit review: preserves an immutable audit entry.
pnpm performance:reconcile -- --owner ACCOUNT_UUID --event EVENT_UUID --accept ACTIVITY_UUID --apply
pnpm performance:reconcile -- --owner ACCOUNT_UUID --event EVENT_UUID --reject --apply
```

Policy v1 matches plausible workouts from summary-only evidence: local calendar
date, target-distance eligibility, treadmill compatibility, reasonable moving pace
and decisive candidate score. Multiple record distances can share one workout.
It never reproduces or changes Excel times. Close paces, incompatible subtype,
impossible distance/pace and uncertain date drift fail closed. Adjacent-day
candidates are review-only; there is no automatic inferred timezone correction.
Exact score bands are documented in [implementation notes](implementation/issue-151.md).
Automatic replay never replaces an accepted mapping or operator decision. Repeat
operator review explicitly to revise one. Re-import preserves stable event IDs,
raw provenance and reconciliation heads. Inspection shows the stored decision
separately from the current proposed candidate result. Event detail shows its
accepted activity and decision method/version/reason.

## Separate explicit historical catch-up

Requires separate primary/detail `sportos_app` URLs, the local API on its configured
loopback origin, and `SPORTOS_DEV_AUTH_TOKEN` for authenticated local POSTs. This
operator workflow is intentionally local; hosted/OIDC batch execution is not
implemented. The command checks the authenticated owner and sends session cookies
and CSRF, never browser/provider credentials in arguments or files.

```bash
# Preview ONE bounded batch: metadata only, zero provider requests or writes.
pnpm performance:catchup -- --owner ACCOUNT_UUID --limit 25
# Inspect and explicitly apply; checkpoint MUST be outside the repository.
pnpm performance:catchup -- --owner ACCOUNT_UUID --limit 25 \
  --checkpoint /private/local/path/catchup.json --apply
# Resume by running the same command. It processes one batch, never an implicit loop.
# Retry current unavailable retained/provider evidence only when explicitly desired:
pnpm performance:catchup -- --owner ACCOUNT_UUID --limit 25 \
  --checkpoint /private/local/path/retry.json --retry-unavailable --apply
```

The command derives the actual latest Excel event date separately per target.
Targets without historical rows have no invented cutoff: they are computed
opportunistically when another target selects the same run. They do not select
an entire older archive by default. An explicit `--from` opts into that bounded
additional history for targets without an Excel cutoff. If there are **no Excel cutoffs at all**, default
execution stops with `no_excel_cutoffs`, fetching nothing. An operator can explicitly
choose a bounded alternative range with `--from YYYY-MM-DD --through YYYY-MM-DD`;
this is a deliberate separate history scan, not a claim about workbook cutoffs.
Dates and UUIDs are validated. The checkpoint freezes owner, through date, optional
from date and cutoff metadata; changed cutoffs require restarting a fresh scan.

Activity UUID pagination and target union avoid downloading the same run for
multiple target distances. Retained current measured targets skip; current retained
streams with stale/unprocessed projections reprocess without requests. Missing or
outdated streams use the existing authenticated explicit Fetch Detail operation.
Unusable current evidence is unavailable, not ranked; `--retry-unavailable`
explicitly refreshes it. Short runs never enter a target's candidate set. The
projector still uses native retained coverage and never extrapolates from corrected
canonical distance. Ordinary sync, matching, navigation and leaderboard GET never
fetch rich history.

Each apply batch runs serially, checkpoints completed activities atomically with
0600 files, and holds a checkpoint lock. A failure stops before advancing over the
failed activity. Rate-limit retry times persist; rerunning before due makes no
request. Transient request failures retry once; retained cache reuse handles
interruption after retention. Keep the checkpoint and rerun after the failure is
resolved. A hard process kill may leave `catchup.json.lock`: confirm its PID is no
longer running before removing that lock. Do not run multiple independent scans
against the same activities concurrently. Start a fresh scan after new summary
imports/source versions or algorithm updates; UUIDs inserted behind a cursor are
picked up on the next scan. A checkpoint is local operator progress, not a durable
provider-sync job or a claim that the archive is complete.

Output distinguishes eligible, already current, retained stale/unprocessed,
needs rich fetch, unavailable and failed, plus progress/reason counts. It contains
no tokens, raw GPS/resources, filenames, storage paths or provider payloads. Data
quality can leave a successfully processed activity without a ranked effort.
Official canonical facts, Daily scores, ledger and snapshots are unchanged.
