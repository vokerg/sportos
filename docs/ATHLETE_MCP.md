# Local read-only athlete MCP and private IronMan handoff

Issue #211 adds a local stdio MCP server and a deterministic private snapshot and
Russian performance report. No HTTP listener is created. Starting it intentionally
authorizes the selected local MCP host to receive the bound account's private
metrics. Configure only trusted hosts. Remote hosting/authentication is separate
work; do not put this process behind a public gateway.

## Build and trusted account binding

Use Node 22+ and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm --filter @sportos/mcp build
```

The **operator**, never a model/tool request, sets:

- `SPORTOS_MCP_ACCOUNT_ID`: required internal account UUID. Bind the intended
  existing account explicitly; no first-account lookup, email matching or remote
  owner selection occurs. The fixed legacy account described in
  [authentication](AUTHENTICATION.md) is appropriate only when the operator
  intentionally selects that local dataset.
- `SPORTOS_MCP_DATABASE_URL`: optional dedicated runtime connection; otherwise
  the existing `DATABASE_URL` is used. Only the non-owner `sportos_app` role is
  accepted. Superuser, BYPASSRLS, inherited table ownership, migration, dispatcher,
  worker-data and legacy connections are rejected. `sportos_legacy` lacks the
  projection permissions needed by this feature.
- `SPORTOS_MCP_TIMEZONE`: IANA zone, default `Europe/Copenhagen`.
- `SPORTOS_ACTIVITY_DETAIL_DATABASE_URL`: optional existing separate non-owner
  detail connection, used only on explicit activity-details calls for retained
  laps. Neither snapshots, volume, search nor leaderboards query the detail DB.

The process loads an existing nearest `.env` from its **working directory**,
without overriding injected environment variables. Keep credentials in protected
operator configuration; never write them into a tracked MCP client JSON file or
command-line arguments. Neither tool arguments nor output contain the owner UUID.
No provider credentials or schema-owner connection is used by this process.

Run from the checkout with the binding already set in the parent environment:

```sh
node apps/mcp/dist/main.js
```

Stdout is exclusively MCP JSON-RPC. Use the Node entrypoint in client configuration;
normal `pnpm run` banners can corrupt the protocol. `pnpm --silent mcp` is a shell
convenience, but the direct Node entrypoint is preferred for clients.

For a generic MCP client, a protected **local** wrapper can change to the checkout
and execute that Node entrypoint. Supply the trusted binding through the host's
protected environment/configuration. Example configuration contains no credentials:

```json
{
  "mcpServers": {
    "sportos": {
      "command": "/absolute/path/to/private-local-sportos-wrapper"
    }
  }
}
```

The wrapper and any host logs that contain tool results must remain private. Do
not enable result logging to public traces or shared telemetry. The MCP client is
authorized by the intentional local process launch; this is not an interactive
browser login or an authorization mechanism for unknown remote clients.

The server uses the [official TypeScript SDK v2 stdio transport](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server).
A local host launches the child process and owns its lifetime. No provider network
client is linked into the application.

## Five tools

All objects reject unknown keys. Dates are real ISO calendar dates, inclusive,
1970–2100; future end dates are rejected. UUIDs are validated. Explicit range
queries span at most 18,300 days. Pagination is `limit` 1–100 (default 50), `offset`
0–50,000. Bounds apply before reading. Errors are sanitized typed errors:
`NOT_FOUND`, `UNAVAILABLE`, `INVALID_INPUT`, `BUSY`, `OUTPUT_LIMIT` (SDK input
validation and unknown-tool errors also use standard MCP error handling).

| Tool | Required input | Optional input / semantics |
| --- | --- | --- |
| `get_athlete_snapshot` | `{}` | `asOfDate`, unique subset of `windows: [7,28,30,90,180,365]`; full versioned snapshot |
| `get_training_volume` | `from`, `to`, `period` | `discipline`; periods `daily`, `weekly`, `monthly`, `annual`; paginated calendar buckets |
| `get_personal_bests` | `discipline`, `from`, `to` | Running requires `distanceM` 5000/10000/15000/20000/21097.5/25000/42195; bike/swim optional target |
| `search_activities` | `from`, `to` | `discipline`, allowlisted `source`/`subtype`, min/max `DistanceM`, min/max `DurationS`, `maxPaceSPerKm`, `minSpeedKmh` |
| `get_activity_details` | `activityId` | Canonical facts, current numeric metric projections and explicitly requested retained laps |

`discipline` is run/bike/swim; omitted means all three. Search duration filters use
canonical elapsed/recorded `duration_s`; pace/speed filters use positive moving
time with an explicit elapsed fallback. Search is descending date, ascending UUID.
Search returns filtered total, page and coverage; weekly/monthly/annual bucket
pages are ascending calendar order and include empty buckets. `total` for volume
is the number of buckets, not sessions. For a discipline-filtered volume response,
other disciplines are empty rather than inferred. Use the per-discipline session
and known-value counts.

For bike/swim, target distance tolerance is 1% (minimum 1 metre). Targeted ranking
uses **elapsed seconds** within that distance band, with exact distance/time
preserved. Without a target, results are ranked by whole-session pace and are
explicitly labelled session averages, not interval PRs. Conditions are comparable
only to the extent of retained subtype; weather/course/equipment are unknown.
Historical summary reconstructions are excluded from these benchmark rankings.
No 1500 m swim split is invented from a 1600 m session average.

Running reuses `DistanceLeaderboardRepository`: imported historical authority and
current measured-input continuous-effort calculations retain source, pause policy,
rank, alternatives count, citation UUIDs and coverage. Summary-only estimated
continuous efforts are **not** promoted into measured rankings. Snapshot lifetime
and recent running tables each select up to ten entries per supported target;
use the paginated tool for additional entries.

Activity details never return notes, names, correction reason text, raw JSON, GPS,
provider account/native identifiers, source hashes, storage information or owner
fields. Laps use current retained Strava references first, then current linked
Garmin native FIT laps, capped at 100 with explicit truncation. Fixed numeric
fields and units only; FIT timer time remains separate from moving time. There is
no detail fetch, stream processing or synthetic split reconstruction. The two
physical databases have separate read snapshots; linked source versions are
matched, but there is no cross-database atomicity claim. Unavailable detail leaves
canonical facts usable and gives an explicit laps status.

## Snapshot semantics

`packages/analytics/src/athlete-snapshot.ts` owns the pure domain types and
calculations. `packages/db/src/repositories/athlete-data.repository.ts` owns the
compact allowlisted primary reads, reusing canonical distance/subtype expressions
and the existing provider metric catalog/freshness policy. `AthleteReadService`
in `apps/mcp` is shared by the CLI and MCP tool. The executable Zod output contract
is in `apps/mcp/src/contracts.ts`; a generated JSON Schema is in
[schemas/athlete-snapshot.v1.schema.json](schemas/athlete-snapshot.v1.schema.json).
Both paths validate the complete output before release.

- Schema: `sportos.athlete-snapshot.v1`; methodology: `canonical-calendar-v1`.
- `asOfDate` is the requested date. For execution-day snapshots the incomplete
  local day is excluded; `completeThrough` is yesterday. Earlier dates are
  included in full. `generatedAt` and timezone make the policy reproducible.
- Canonical `activity_date` retains original source-local semantics. The configured
  timezone determines the current day; it does not reinterpret historical dates.
- Other tools obey the explicit range, including today if requested, and return
  versioned `metadata` with `incompleteDayIncluded`, read time and timezone.
- Trailing N-day windows include `completeThrough − (N−1)` through
  `completeThrough`. Monthly tables cover twelve calendar months including the
  current partial month. Weekly tables cover 52 **complete** Monday–Sunday weeks.
- One canonical UUID is one session. Identical UUID duplicates converge;
  conflicting duplicates fail. Garmin enrichment never adds another session.
- Metres, seconds, bpm, watts, s/km, s/100m and km/h are explicit. Distances use
  canonical manual corrections. Original distance is retained beside corrected
  values without narrative correction reasons.
- Canonical `duration_s` is exposed as `elapsedS`; historical imports may not
  distinguish elapsed and active exercise duration. Interpret those rows with
  their source and historical-summary flag rather than assuming timer precision.
- `movingS` and `elapsedS` sum only known values with separate counts. If no
  values exist, totals are null. Empty bucket sessions are zero; unknown volume
  is null. Missing records do not prove rest or complete archive processing.
- Pace requires paired positive distance/time, preferring moving seconds then
  elapsed fallback. Weighted pace is sum paired seconds / sum paired kilometres;
  mean/median are over session paces. Fallback counts are explicit. No total-time
  substitution is silently added to the moving-time sum.
- Numeric projection extras require current head/source/version/parser/input hash,
  allowed state, catalog key/unit/bounds and catalog provider priority. Canonical
  fields retain authority. Missing canonical HR/calories/ascent may have separately
  labelled supplemental observations in `metrics`; canonical fields/counts remain
  unchanged. Provider origin, source kind, derivation method and projection time
  accompany examples.
- Coverage is retained-record coverage, not a general audit, complete-archive
  certificate or assertion that provider sync is up to date.
- No scoring points enter physiological load, no FTP/CSS/zones are inferred,
  no race forecast or medical readiness determination is generated.

Every query executes through `withAccountContext` in a reserved connection and a
repeatable-read **READ ONLY** transaction. Query statement timeout is 20 seconds;
idle transaction timeout is 30 seconds. The compact archive cap is 50,000 canonical
sessions and 1,000,000 candidate numeric projections per call, with explicit failure
instead of silent truncation. Each process serves one active tool call and at most
30 calls/minute. Successful structured JSON is capped at 2 MB (also mirrored into
a text content block for generic clients). These are local transport limits, not
a substitute for remote-service authentication or infrastructure controls.

## Generate the mandatory private pair

With local operator binding/configuration in place:

```sh
pnpm athlete:snapshot
# Optional explicit date/destination:
pnpm athlete:snapshot -- --as-of YYYY-MM-DD --output-dir /absolute/private/path
```

Default destination:

```text
${HOME}/SportosPrivate/athlete-snapshots/YYYY-MM-DD/
  athlete-snapshot-YYYY-MM-DD.json
  athlete-performance-report-YYYY-MM-DD.md
  manifest.json
```

The resolved destination must be outside **every** Git repository/worktree,
including ignored folders, linked worktrees, bare repositories and symlink aliases.
Directories use mode 0700 and files 0600 where supported. Writes use exclusive
0600 temporary files, fsync and atomic rename; the manifest is published last with
relative filenames, versions and SHA-256 hashes. Verify both hashes before using
a pair after regeneration; publication is atomic per file, not across all three.
Only private local artifact locations are printed, never athlete result rows.
Do not invoke the real-data generator in CI, attach the artifacts to issues/PRs,
use them in fixtures or put them in either Sportos or IronMan Git.

The Russian report renders the JSON deterministically into all 20 requested
chapters: yearly/monthly/weekly comparisons, each discipline, catalogue, coverage,
methodology, UUID appendix and an initial IronMan context note. It is a standalone
factual baseline. IronMan's own language, results-vs-forecasts and manual plan
approval conventions are respected. This command does **not** change IronMan.

## Validation

```sh
pnpm --filter @sportos/analytics test
pnpm --filter @sportos/mcp build
pnpm --filter @sportos/mcp test
# Disposable/synthetic non-owner integration database migrated through V142:
SPORTOS_OWNER_TEST_DATABASE_URL=... pnpm --filter @sportos/mcp test
```

Integration fixtures have synthetic owners and values. They check all five reads,
foreign/nonexistent UUID equivalence, database-enforced read-only behavior,
connection context cleanup, corrected swim distances, provider deduplication,
projection freshness, imported-vs-calculated methods, narrative exclusion and an
independent generic SDK client over the actual stdio subprocess. CI runs those
checks only against its configured test database; real athlete data is unnecessary.

To exercise retained lap integration as well, set
`SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL` to a separate **synthetic** detail
database migrated through V004. That test uses a rollback transaction and checks
current/stale versions, foreign-owner exclusion, Strava allowlisting, Garmin FIT
units and the 100-lap sentinel. CI's primary ownership gate does not require an
operator's private detail database.
