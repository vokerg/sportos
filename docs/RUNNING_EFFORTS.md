# Per-activity running efforts (#122)

Apply primary Flyway **V135** before deploying algorithm v4. V133 introduced
the projections, V134 permits continuous-section qualification, and V135 enforces
the bounded distance/pause qualifications. The existing separate detail
schema through V003 is reused unchanged. `/activity/:id` shows independent Strava
and Garmin results for 5, 10, 15, 20, 21.0975 (displayed 21.1) and 25 km. The central
catalog is `packages/domain/src/running-efforts.ts`; extending it requires a
calculation version bump and retained reprocessing, not a schema migration.

These are analytical **pause-excluded** efforts, not race-standard elapsed times,
certified personal records or Run Lab rankings. No canonical activity, daily fact,
score, ledger, snapshot or performance event is changed. Each provider uses only
its own distance/time evidence; disagreements remain visible.

## Evidence and calculations

- **Estimated · Strava summary · average pace** uses
  `target × moving_time / distance`. It is uniform average pace within the actual
  run, with no segment offsets. Only the current linked `strava_api` summary is
  eligible. Missing summary scalars may fall back to a Strava-owned canonical row
  only when its source record and native identity match that exact current link.
  Manual/workbook values never supply the estimate. Missing/invalid values are
  unavailable, not guessed.
- **Calculated · Strava streams · moving time** uses the existing retained
  `time`, `distance`, `moving` stream objects and aligned `.data` arrays. Sampling
  metadata, when present, must agree. Ordinary intervals are stopped when **both
  bounding moving flags are false**; short transition intervals count
  conservatively as active. A sparse true → false interval over 30 seconds may
  use the bounded stop-marker convention only when its distance change is at most
  10 m and the next sample is moving within 30 seconds. Such intervals contribute
  zero active time/distance and remain part of a continuous analytical timeline.
  Every selected window crossing one is qualified with a bounded-pause reason. Slow running and active zero-distance intervals count. This convention
  prevents a transition sample from removing traveled running time; boundary pause
  uncertainty may conservatively add up to one sample interval. Fully stopped
  intervals contribute zero duration and zero running distance, even when the
  native cumulative distance advances during the stop.
- **Calculated · Garmin FIT · timer-active time** reads decoded native FIT
  `record` timestamp/distance and `event` timer fields in the extractor's retained
  fields-array format. It requires alternating start/stop evidence bounding the
  record coverage. Start/resume is `start` (0); supported stops are `stop` (1),
  `stop_all` (4), `stop_disable` (8), `stop_disable_all` (9). Unknown timer types,
  nonzero event groups, missing boundaries and multiple/missing sessions fail
  closed. Other event kinds are ignored. Native decoded metres and UTC ISO
  timestamps are used without reapplying FIT binary scaling.

The fastest contiguous traveled-distance window is evaluated at both start and
end distance breakpoints, with piecewise-linear interpolation at boundaries.
Active time and elapsed offsets are independent. Active zero-distance time inside
a window counts; dwell before its start or after its end does not. Equal durations
within 1e-9 seconds choose the earliest start. Fractional distances and seconds
remain unrounded in persistence; only UI durations round to seconds.

Measured targets accept an explicit shortfall of at most **0.1%, capped at 10 m**
(5 m at 5 km, 10 m for 10 km and longer). A qualifying near-target window uses
its actual recorded duration and offsets, with `distance_tolerance`; no sample,
distance, second or endpoint is invented. Actual source and active coverage
remain unchanged. Summary-only estimates retain their strict source-distance
eligibility. Garmin compact distance below 4,995 m skips large FIT reads and
returns Too short. This deliberately conservative preflight may omit a FIT-only target if
that version's summary itself reports less than the target. Strava stream coverage
uses native stream distance minus fully stopped distance, not Garmin or corrected
canonical distance. Garmin coverage likewise excludes fully timer-stopped
distance. Recorded source distance remains unchanged in provenance. All distance in an
evidenced pause is excluded, including walking while stopped. Target tolerance
qualifies only a small shortfall; it never credits stopped movement as running.

## Deterministic limits and unavailable data

Version 4 accepts at most 200,000 samples, 10,000 timer events, 1,000,000 metres,
and a 604,800-second activity timeline. Timestamps must strictly increase and
cumulative distance cannot decrease. Duplicate/missing timestamps, nonfinite or
negative values, distance resets, misaligned stream arrays/metadata and running
jumps above 12 m/s invalidate measured computation. An active recording interval
longer than **30 seconds** is an unknown gap. A fully evidenced pause can be
longer; its duration and distance are excluded. Garmin traveled intervals
spanning a timer transition fail closed because distance at the transition is unknown; no distance/time is
invented to split such an interval. Missing/wrong FIT units and duplicate native
fields fail closed; developer fields do not override native fields.

Version 4 keeps bounded stop-marker intervals within the analytical timeline.
Other unknown active intervals longer than 30 seconds still split Strava streams.
Measured windows must lie wholly within a continuous section; no window joins
sections across a gap. Calculated results say they cover only retained continuous
sections. Calculated coverage reports the chosen section; unavailable coverage
reports the longest retained section. Offsets still refer to
the first activity sample. Targets without a continuous measured window fall back
to labeled Strava summary estimates, or Unavailable when the summary is too short.
Partial sections with distance/pause tolerances are explicitly qualified as
`partial_stream_coverage_with_tolerance`. A near-target window crossing a bounded
pause says `distance_and_pause_tolerance`. Other invalid evidence still rejects
the whole measured timeline. Garmin retains
its fail-closed policy for unknown active gaps and mixed timer transitions.
Strava falls back to an explicitly
**estimated** current-source result with the failure reason. Garmin returns
**Unavailable** with its reason; it never substitutes elapsed time or another
provider's distance. Fully stopped distance is valid pause evidence, not an
invalid transition.
Version 1 instead rejected any stopped distance increase; #124 corrects that
overly strict behavior. Earlier algorithm versions become Stale on deployment
until explicitly reprocessed with Calculate retained efforts. Historical
projections remain immutable, and reprocessing makes no provider requests.
Missing rich history is expected; full archive #98 and recurring #99 are not prerequisites.

Strava documents moving booleans but does not specify exact transition interval
allocation. The bounded stop-marker rule is a maintainer-authorized application
convention, not a claim that uncertain boundaries are exact provider timer events.
It never uses Garmin evidence to fill Strava gaps.

Source contracts were checked against the [Strava stream reference](https://developers.strava.com/docs/reference/#api-Streams-getActivityStreams),
[Garmin activity encoding guidance](https://developer.garmin.com/fit/articles/cookbook/encoding_activity_files.html)
and [Garmin's FIT profile](https://github.com/garmin/fit-python-sdk/blob/main/garmin_fit_sdk/profile.py).

## Storage, freshness and UI

Primary `running_effort_projections` and `running_effort_values` are immutable
compact metadata/results. `running_effort_heads` is the current per-owner,
activity/provider pointer. Source reference/hash, resource signature and algorithm
version distinguish retained inputs; projected timestamps and measured offsets
provide provenance. No second raw FIT/stream copy is stored. Raw resources and
original bytes remain in their existing detail/blob stores.

Forced RLS, same-owner foreign keys, source-membership and immutable-owner/history
triggers apply. App/worker-data have scoped read/insert privileges and head updates;
dispatcher, legacy and shared roles have no access. Auxiliary reads use the same
owner via the API-only non-owner detail role. Primary publication rechecks the
current source under the reconciliation lock and full-precision inspection time.
An expected Strava resource fingerprint is recorded **before mutable stream
replacement** so an inspection of old content cannot publish after that intent.
Failures retain historical success but hide its durations as Failed; changed source
or algorithm versions hide old results as Stale. The browser receives safe method,
quality, coverage, algorithm version, offsets and timestamps, never hashes, owner
IDs, paths, locations, raw resources or credentials.

The effort table and per-target diagnostics show current calculated/estimated
results only. Distances unavailable from both providers are omitted; distances
with one provider result retain a dash for the other. Empty/stale/failed evidence
keeps an explicit state and the retained-processing action. The complete target
catalog and unavailable reasons remain in the API/persistence read model.

Navigation reads only compact primary projections. It does not calculate, read
streams/FIT, download, or write. New/pre-migration history is Unprocessed until a
retained calculation or backfill. Missing migration leaves the section unavailable
without breaking canonical detail. Existing provider Fetch/View/Refresh remains:

- Explicit Strava Fetch/Refresh/cache reuse processes only Strava efforts.
- Garmin original commit (including successful day activity retention) and explicit
  Garmin Fetch/Refresh/cache reuse process only Garmin efforts. Pending/unlinked
  Garmin data remains pending; later links are eligible for retained reprocessing.
- **Calculate retained efforts** invokes
  `POST /activities/:id/efforts/reprocess` with an empty body, normal session/CSRF,
  a canonical run UUID and the session owner. It processes both retained sources
  without provider calls. Unknown/private/download parameters are rejected.
- View is read-only. Fetch Strava detail remains the selective way to obtain rich
  data for an interesting run; no mass fetching or bulk-fetch UI is added.

Retention and projection are separate commits across databases. Interrupted writes
can leave safely retained evidence and stale/failed results. Retry the explicit
fetch/reprocess workflow. If mutable Strava replacement failed after recording an
expected new fingerprint, use explicit Refresh to retry that retention intent;
retained processing of the old content stays stale. Existing source-version and
reconciliation authority remains unchanged.

## Retained-only historical backfill

Use **two separate non-owner `sportos_app` runtime URLs** in `DATABASE_URL` and
`SPORTOS_ACTIVITY_DETAIL_DATABASE_URL`. No provider credentials or helper login are
required. This operator command requires an explicit authorized account UUID;
browsers never submit owners. Reports contain counts, reason categories and the
canonical pagination cursor, never personal metrics/raw source content.

```bash
# Read-only inspection first, one bounded batch (default 25, maximum 100).
pnpm activities:efforts -- --owner ACCOUNT_UUID --limit 25

# Apply the inspected batch explicitly.
pnpm activities:efforts -- --owner ACCOUNT_UUID --limit 25 --apply

# Resume after successful completion; keep the cursor/report private.
pnpm activities:efforts -- --owner ACCOUNT_UUID --limit 25 --cursor LAST_CURSOR --apply
```

The command scans only canonical runs, ascending by UUID. It processes one source
at a time, loads only time/distance/moving fields or native FIT record/timer fields,
requires all declared Garmin chunks and consecutive record indices, and never
loads originals or other rich telemetry. Compact signatures skip unchanged
source/resource/algorithm versions before rich reads. Cache reuse preserves the
projection/head timestamp and creates no duplicates. Each source commits atomically;
successful sources survive another source's failure. Failed reads/publications retry
once. Any error or stale publication race leaves the input cursor unchanged and exits nonzero; replay that
batch. Retry stale batches after the concurrent fetch finishes. Rerun from the start after new imports/source/version changes;
UUIDs inserted behind a cursor belong to the next scan.

Initial #122 delivery performed no live migration, bulk backfill or provider
download. Repair #124 applied the reviewed local-app migrations and recalculated
only the maintainer-selected activity. Historical bulk apply remains a separate
explicit operator action.

## Repeatable validation

Sanitized fixed-pace/split/interpolation/tie fixtures and current stored stream/FIT
envelopes cover pauses, missing/invalid evidence and source disagreement. Disposable
primary/detail integration uses `SPORTOS_OWNER_TEST_DATABASE_URL`,
`SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL`, `SPORTOS_WORKER_TEST_DATABASE_URL`, and
`SPORTOS_WORKER_DATA_TEST_DATABASE_URL` with their intended runtime roles. It covers
rich upgrades, invalidation, algorithm/source changes, idempotency, partial retry,
cursor dry-run/apply/replay, both-database isolation, dispatcher denial and unchanged
nonempty canonical/daily/ledger/snapshot/Run Lab rows.

For a populated disposable upgrade: migrate through V132, apply
`scripts/running-efforts-upgrade-fixture.sql` with the isolated schema owner,
migrate V133, then run `scripts/verify-running-efforts-upgrade.sql`. It compares
complete official rows and asserts that migration did not backfill private data.
Fresh migrations through V135 and populated V134 → V135 qualification checks
are required, alongside Flyway validation. Never
point synthetic fixtures at personal or hosted databases.

Focused evidence and inspected files are in [implementation notes](implementation/issue-122.md).
