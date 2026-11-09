# Garmin rich acquisition: JSON coverage and selective FIT fallback (#246)

Day Fetch/Refresh always refreshes the requested wellness categories and compact
activity discovery. It retains every discovered sport. Rich acquisition uses
policy v1 and the positive allowlist below. Navigation remains retained-only;
fetching evidence never changes canonical facts, scores, ledgers or snapshots.

| Sport | Automatic rich endpoints after summary | FIT decision |
|---|---|---|
| Outdoor/trail/track/treadmill run | Full chart + splits | JSON if complete chart and cumulative timer intervals are trustworthy; otherwise precise fallback |
| Outdoor/indoor cycling | Full chart + splits | JSON if chart and genuine laps are complete; absent optional power/cadence/GPS does not require FIT |
| 25 m pool swim | Full chart + splits with nested lengths | JSON if every length, idle row, index, active count and duration passes parity gates |
| 50 m / yard / unfamiliar pool | No speculative rich JSON probes | FIT: this account has no real-device unit/length parity specimens for these pools |
| Open-water swim | Full chart + splits | JSON chart/laps; never interpreted as pool lengths |
| Strength | Full chart + exercise sets; no splits | JSON; absent/unknown set types remain incomplete evidence and never imply zero scoring or require FIT |
| Walking, rowing, SUP, unfamiliar types | Compact day discovery only | Never automatic FIT; explicit full FIT remains available for supported matched sports |

The pinned `garminconnect==0.3.17` SDK calls are `get_activity(id)`,
`get_activity_details(id, maxchart=150000, maxpoly=0)`,
`get_activity_splits(id)` and `get_activity_exercise_sets(id)`.
They use the SDK activity summary, `/details`, `/splits` and exercise-set
endpoints. No separate map request is made: native charts already carry GPS
when recorded. A JSON-first activity normally makes **three** logical calls,
including summary; it does not make every endpoint call for every sport.

## Sport × feature × source matrix

This is the inventory of existing full-FIT readers, including read-only athlete
MCP and mobile consumers. FIT-only originals/developer fields remain on demand.

| Feature / consumers | Native JSON evidence and units | Fallback / non-applicable policy |
|---|---|---|
| Identity, reconciliation, source versions | `activityId`, `activityTypeDTO.typeKey`, `summaryDTO.startTimeGMT`, distance (m), elapsed/moving duration (s) | Same versioned matching policy, owner lock and immutable linked UUID; no nearest-match guessing |
| Core metrics and comparisons | Summary `distance`, `elapsedDuration`, `movingDuration`, `duration`, `averageSpeed`, `maxSpeed`, HR, calories, elevation gain/loss | Moving, timer and elapsed remain separate. Canonical/manual authority wins. Missing sensors stay absent |
| Average run dynamics | `averageRunCadence` / `maxRunCadence` (steps/min), `strideLength` (cm→m), `verticalOscillation` (cm→mm), `verticalRatio` (%), `groundContactTime` (ms), optional `groundContactBalance` (%) | Native cadence may include fractions absent from FIT integer cadence. Retain distinct provenance; never double native steps/min. Missing balance/stance ratio is an optional gap |
| Lap dynamics and genuine laps | Ordered `lapDTOs`: distance, `duration` (timer s), `elapsedDuration`, moving duration, HR, power and dynamics | No synthetic laps from summary averages. Missing required lap timing triggers FIT; strength does not request laps |
| Power / cycling analysis | Summary `averagePower`, `maxPower`, `normalizedPower`, `trainingStressScore`; optional bike cadence | Absent power meter/TSS is not a fallback trigger. Unsupported fields stay missing |
| Training Effect | `trainingEffect`, `anaerobicTrainingEffect` | Provider indices, separate from official points; no FIT for absent TE |
| Work / other FIT session fields | Native `totalWork` units do **not** match FIT `total_work` in the retained sample | Not mapped by guessing. `optionalGaps: total_work_unit_unverified` and partial JSON metric coverage are visible; explicit full FIT supplies original work/temperature/stance-only values |
| Every pool length, including idle/rest | `lapDTOs[].lengthDTOs`: global 1-based `lengthIndex`, `duration` (s), distance (m), `totalNumberOfStrokes`, `swimStroke`; enclosing lap retained | Verified 25 m active rows carry exactly one pool distance; idle rows omit/null distance, stroke and strokes. Accept only with contiguous unique indices, exact summary active count and both lap/session duration sums within 0.1 s. Unknown/missing/inconsistent rows fall back |
| Pool strokes, style, SWOLF and grouping | Each active row's strokes/style; SWOLF = timer seconds + strokes (same established FIT presentation); `lapNumber` preserves grouping | Never manufacture missing strokes/style. Summary active count, pool size, SWOLF and stroke totals have native provenance. 50 m/yard remain conservative FIT |
| Corrected swim distance | Original native lengths unchanged; API applies existing effective/recorded distance and effective-length display separately | A correction never changes native durations, lengths, strokes, style or SWOLF; no provider request or implicit score write |
| Running best efforts | Complete `directTimestamp` (UTC ms), `sumDistance` (m), `sumDuration` (timer s) chart columns | Algorithm v6 uses independent native `json_calculated` / `cumulative_timer` windows. Each interval must be fully active or fully stopped. Exclude evidenced stopped drift/time; reject mixed transitions, active gaps >30 s, invalid distance/speed or missing samples. Never estimate a measured window from laps |
| Trusted Strava efforts | Existing Strava streams remain an independent source | Valid Garmin JSON does not download FIT to duplicate Strava. No joining providers or filling Strava gaps with Garmin. If native timer evidence itself is untrustworthy, the explicit Garmin comparison still needs its own bounded FIT evidence |
| Garmin timelines: run/bike/swim/strength | Full-resolution native chart HR, speed, distance, power, cadence, altitude, temperature, GCT and oscillation where present | Require returned row count = `totalMetricsCount`, unique descriptors/indices, known units and increasing timestamps. Preserve missing samples and gaps. Display downsampling remains separate from retained precision |
| Garmin-only routes, maps, heatmap | Native `directLatitude` / `directLongitude` (degrees), `directTimestamp`; route resolution `json` | Existing Strava privacy gate/source preference remains authoritative; never reveal Garmin GPS behind a linked Strava privacy gap. Indoor pool maps remain excluded. Missing GPS is optional, not a FIT trigger |
| Strength evidence and explicit daily scoring | Native exercise-set JSON → existing immutable compact strength summary | ACTIVE/WORK/etc. classification and once-per-day rounding unchanged. Unknown/partial/unlinked sets preserve the prior score on explicit recalculation. No original FIT prerequisite |
| Raw viewer / acquisition status | Native detail, sets and splits resources; bounded acquisition metadata | API/UI distinguish summary-only, JSON-rich, FIT-retained and incomplete, with JSON feature states, optional gaps and fallback reasons. Hashes/storage references remain private |
| Retained reprocessing / backfill / reconstruction | Current immutable native resources, source hash, metric parser v2, effort algorithm v6 | Reprocessing has no provider dependency. Historical FIT messages/readers stay supported; no new canonical or scoring authority |
| Original file, unknown/developer FIT fields, irrecoverable per-record details | Actual original FIT/ZIP and strictly decoded records | Explicit **Fetch full Garmin FIT / Redownload full Garmin FIT**, including walking and other supported matched sports. Never label JSON as FIT or fabricate FIT messages |

Chart values are already decoded by Garmin. `unit.factor` is **not** a scale to
apply again: local comparison confirmed native distance/speed/elevation values
already match decoded FIT. Native timestamps are milliseconds, cumulative timer
values seconds, and oscillation is centimetres. Only documented, checked reader
conversions apply. Unknown descriptor units fail the capability gate.

## Retention, freshness and failure behavior

- Historical `sportos.garmin-single.v1` FIT bundles remain readable. JSON-rich
  `sportos.garmin-single.v2` bundles contain native `detail`, `sets`, `laps`, an
  acquisition policy version, feature states and exact expected descriptors.
  They have **no original, fit_manifest or fabricated records**. Non-applicable
  sets/laps use explicit empty envelopes without upstream calls.
- Full endpoint JSON is retained privately before normalization/fallback. All
  resource bytes are hashed and checked before publication. Immutable resources
  land in the separate detail database before the owner-scoped primary version,
  reconciliation and strength summary commit. An incomplete/failed publication
  leaves the prior primary head and immutable resources intact.
- The API independently validates native coverage before accepting a JSON-only
  commit. Caller-supplied feature labels cannot waive required resources or gates.
- Day attempt metadata keeps private discovery fingerprints. An unchanged
  discovery row with sufficient retained resources skips rich work; changed or
  missing evidence checks fresh summary metadata before local cache reuse. Old
  attempts without fingerprints check metadata once. This detects list-visible
  changes; edits invisible to discovery still require explicit full Redownload.
- Native policy/metric/effort versions distinguish parser changes from source
  changes. Retained-only processing can rebuild projections without Garmin.
  A fresh network observation of old content can promote that immutable version
  again without rewriting its original bundle/history timestamp.
- Four pending activities share one Python process/SDK login. Each group remains
  within the existing 20-request bound, 0.5 s spacing, response bounds and bridge
  deadline. The worker still fences retention with its persisted lease and
  rotates the encrypted session normally. Rate limits/auth failures stop later
  group work; successful earlier activities remain retained.
- Native chart gaps caused by legitimate pauses remain visible in timelines;
  cumulative timer evidence controls effort eligibility. Missing optional HR,
  cadence, power or GPS never independently causes an original download.
- Per-activity full Fetch requires an original even after JSON completion.
  Redownload bypasses both JSON and FIT caches and actually requests Garmin's
  original. Repeated identical bytes converge; changed originals make a new
  immutable source version. Prior versions and canonical UUIDs remain unchanged.

Apply primary **V146** and detail **V007** before deploying the readers/workers.
They extend only metric/method/pause/route provenance constraints; existing
ownership, RLS, grants, original history and canonical/scoring rows stay intact.

## Local evidence and performance (2026-11-09)

All live responses/originals, identifiers, dates, coordinates and credentials
stayed outside Git. Tests contain synthetic numbers with verified native field
shapes. Private real-data comparisons produced these aggregate results:

- 12 complete retained running/track chart/FIT pairs: 7 comparable measured
  effort windows; maximum duration difference **0.0000574 s**, none over 0.05 s.
  Short activities yielded no invented long-distance effort. Cumulative timer
  semantics were checked rather than inferred from GPS or speed.
- Four 25 m pool JSON/FIT pairs: **175 length rows, including 7 idle rows**;
  zero differences in row kind, duration, strokes or stroke style. Duration
  differences were zero; identical duration/stroke inputs preserve SWOLF.
  Idle fields may be omitted rather than explicitly null. All 17 retained pool
  specimens used 25 m; **no real 50 m or yard specimen was available**, so these
  unit/device variants deliberately retain FIT fallback. Missing/duplicate
  lengths and millisecond mistakes are synthetic fail-closed regressions.
- Summary/FIT checks confirmed running stride length, oscillation, GCT, power
  and Training Effect units; cadence retains the native provider-derived value
  rather than pretending it is identical to FIT's rounded subfield. Work units
  did not pass parity, and that gap is visible instead of guessed.
- New JSON bundles for one real run, bike, pool swim and strength activity were
  published through non-owner roles in disposable loopback primary/detail DBs.
  All four linked; canonical rows were unchanged, original storage was never
  called and no score rows were written. No personal database was migrated.

Representative cold single-activity extraction, including SDK login, downloads,
validation and local retention (one sequential before/after sample, not a timing
SLA):

| Sport | Seconds before → after | Login seconds before → after | Endpoint calls | Response bytes before → after | Retained bytes before → after | FIT calls |
|---|---|---|---|---|---|---|
| Bike | 2.584 → 2.539 | 0.866 → 1.222 | 3 → 3 | 230,661 → 348,171 | 4,740,527 → 348,692 | 1 → 0 |
| Run | 3.115 → 2.676 | 0.862 → 0.932 | 3 → 3 | 639,469 → 570,857 | 8,894,792 → 571,426 | 1 → 0 |
| Pool (25 m) | 2.342 → 2.263 | 0.755 → 0.767 | 3 → 3 | 89,408 → 164,746 | 2,163,693 → 165,273 | 1 → 0 |
| Strength | 2.832 → 2.238 | 0.816 → 0.948 | 4 → 3 | 215,185 → 198,616 | 2,550,521 → 199,103 | 1 → 0 |

A representative three-activity day **including all eight daily category reads**
took **13.935 → 10.179 s**; SDK login time **3.625 → 1.590 s**, login count
**4 → 2**, HTTP endpoint count **17 → 17**, response bytes
**1,307,770 → 1,723,123**, FIT downloads **3 → 0**. Rich JSON can transfer more
bytes than compressed FIT while avoiding decoding/storage and repeated login
costs. These timings run inside the Python benchmark process; OS process startup
is measured separately and not included in these numbers. Five fresh helper
imports had a median process/import startup of **0.059 s** (0.059–0.071 s). The runtime now starts
one helper per four activities rather than one per activity.

Repeat safely with the protected local SDK session (read-only upstream calls;
private temporary activity output is removed afterward):

```bash
~/.local/share/sportos/garmin/venv/bin/python tools/garmin/benchmark_rich.py --activity-id ACTIVITY_ID
~/.local/share/sportos/garmin/venv/bin/python tools/garmin/benchmark_rich.py --day YYYY-MM-DD
pnpm garmin:test
pnpm --filter @sportos/domain test
```

The existing disposable Garmin CI gate now also exercises native JSON publication,
partial retention, repeated delivery, owner isolation, route/metric/effort
projection and unchanged canonical/scoring rows, alongside fresh/populated
migration and worker-role checks. Template/native/mobile tests cover the new
source labels; original FIT paths remain regression-tested.
