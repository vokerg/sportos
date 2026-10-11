# Provider activity metrics and retained backfill (#112)

Apply primary Flyway V129 before deploying this code. The existing dedicated
detail migrations through V003 remain required; no third database or new Garmin
credentials are introduced. Projection changes no canonical activity field,
score, ledger, snapshot, performance event or source-reconciliation decision.

## Versions and authority

`activity_metric_projections` stores immutable bounded inspection metadata;
`activity_provider_metric_values` stores numeric observations per projection,
metric and source field/kind; `activity_metric_heads` holds one current processing
checkpoint per account/activity/provider. Same-owner constraints, forced RLS,
immutable history/owner triggers and explicit app/worker-data privileges protect
these rows. Dispatcher, legacy and shared roles cannot access them. A historical
activity reference is validated at insertion and survives explicit canonical
deletion; deletion cascades only the mutable head. Neither reprocessing nor
backfill deletes original resources or changes canonical rows.

The source reference and hash identify the provider's current compact version.
The input signature additionally identifies inspected rich content, coverage and
strength summary. A parser version belongs to every immutable projection.
Garmin compact/FIT disagreements and Strava compact/detail disagreements remain
separate candidates. Within one provider, explicit FIT enhanced fields take
precedence over legacy FIT fields, then other FIT fields, rich Strava detail,
compact summary and source-backed canonical fallback. All observations are kept.

For core metrics, the read comparison selects the existing canonical column and
its source, including manual/workbook authority. An absent canonical core value
stays absent even if an auxiliary provider has a value. The activity UI may
display a labelled read-only Garmin fallback; that does not fill the canonical
column or change API selection/scoring authority. For extended metrics,
the catalog supplies explicit applicable sports and provider priorities:
Strava then Garmin for shared cadence/power/energy, Garmin alone for FIT running
or swimming dynamics/Training Effect/normalized power/training stress, Strava
alone for weighted power/Relative Effort. A lower-priority provider supplies a
fallback only when the higher-priority observation is absent. This is read-only
selection policy v1, not new scoring/source authority.

Training Effect, Relative Effort, weighted average power and normalized power
have separate keys. Running cadence from explicit FIT `strides/min` becomes
`steps/min` by multiplying by two. General Strava cadence retains its documented
rpm value; it is not silently equated with the explicit FIT running subfield.
Garmin timer duration is not moving duration. Pace is calculated only from
same-origin moving duration and distance; its provenance says `calculated`.
Source-backed fallback uses only a Strava-owned canonical row whose native ID
and source record match the current provider link; manual/workbook fields never
become Strava observations.

Unknown fields/developer fields remain retained raw. Null/absent is not zero;
malformed, nonfinite, out-of-bounds and unknown-unit values are rejected. FIT
inputs are decoded values: do not reapply FIT binary scales. Unitless fields
accept empty/null decoder units only. Cycling intensity factor and unknown
stride/device-specific fields have no v1 mapping. Strength scalars reuse
`garmin_strength_summaries`; detailed exercise rows remain separate (#100).

Field definitions were checked against the [official Strava API reference](https://developers.strava.com/docs/reference/#api-models-DetailedActivity)
and [Garmin FIT SDK session profile](https://github.com/garmin/fit-python-sdk/blob/main/garmin_fit_sdk/profile.py).
The executable catalog in `packages/domain/src/activity-metrics.ts` is the single
mapping authority; sanitized numeric session/source fixtures live in its tests.

## Processing and privacy

List/detail GETs read primary scalar projections and compact identity metadata.
They never invoke either provider or load rich JSON. Provider status distinguishes
linkage, rich raw retention, normalization and freshness. Historical raw coverage
is explicitly unknown until inspected by reprocessing/backfill; it is not inferred
from metric counts. A retained-data checkpoint precedes publication, so an
interrupted projection exposes raw-retained/unprocessed or linked/no-rich-data.
A complete inspection with zero optional values can still be `processed`.
Compact-only evidence is `partial`; stale rich cache is `stale` and its values
are excluded. New compact hashes or parser versions invalidate completion.

Optional metrics absent from recognized fields are counted separately from
rejected fields. Missing-rich categories suggest optional targeted Fetch; the
backfill never fetches them. A failure preserves the previous successful
projection/version/timestamp and exposes only a safe category. Current source
identity is checked under the existing account reconciliation lock at checkpoint
and publication; older inspection timestamps cannot replace newer results.
Retention and projection remain separate commits across the two databases.

`GET /activities` adds lightweight `providerMetrics`; `GET /activities/:id`
also adds `metricComparisons` containing selected values and per-source
candidates. Public provenance includes field, unit, source kind, derivation,
projection UUID and timestamp, never source hashes, owners, storage paths or
credentials. Activity navigation does not project/write. Advanced original
source JSON views remain explicit and unchanged.

Explicit Fetch/Refresh and successful current cache reuse run projection after
retention. `POST /activities/:id/metrics/reprocess` accepts an empty body and
uses the normal authenticated owner/CSRF boundary, without any provider call.
It can normalize compact-only or archived linked evidence without a login.
Manual link review and local original commit project eligible retained data.
A later reverse link is immediately eligible for retained reprocessing/backfill;
worker reconciliation does not gain access to the separate API-only detail DB.

## Operator backfill

Use separate non-owner `sportos_app` runtime connections in `DATABASE_URL` and
`SPORTOS_ACTIVITY_DETAIL_DATABASE_URL`. Never supply migration/dispatcher
credentials. No Garmin helper, Strava client credentials or provider tokens are
needed. The operator must specify the account UUID explicitly; this is a local
operator script, not a browser-supplied owner or public endpoint.

```bash
# Default is read-only dry run; at most 100 activities per invocation.
pnpm activities:project -- --owner ACCOUNT_UUID --limit 25

# Apply exactly one bounded batch. Keep the report's cursor privately.
pnpm activities:project -- --owner ACCOUNT_UUID --limit 25 --apply

# Resume only after a successful batch (hasMore=true).
pnpm activities:project -- --owner ACCOUNT_UUID --cursor LAST_CURSOR --limit 25 --apply
```

The command compiles its package graph before running. It scans account-scoped
canonical UUIDs in ascending order, retries failed inspections once, and reports
eligible, newly projected, already current, compact-only, stale,
linked-but-unretained, missing and errors per provider. Pending/unlinked Garmin
count is a per-owner inventory, not a count within the canonical cursor batch;
pending identities never acquire a fabricated canonical UUID. Other activities
remain valid and receive no invented provider status.

Within a batch, compact metadata is read together and rich resources are inspected
per source. Checkpoints and publication use separate bounded primary transactions,
each rechecking source membership and inspection freshness under the reconciliation
lock. Scalar inserts are chunked to bound SQL parameters. A bulk publication error
falls back to the same per-source workflow so valid rows can converge.

Persist/advance the cursor only on exit zero. Rerun from the beginning after
new imports/source changes; UUIDs inserted behind an existing cursor belong to
the next scan. With errors, `nextCursor` remains
the input cursor and the command exits nonzero. Retry that batch; successful rows
converge. An interruption can replay the same starting cursor safely. Rerunning
unchanged sources/parser makes no substantive mutation, including checkpoint
and projection timestamps. Dry run executes all retained inspections and reports
planned eligibility without checkpoint/projection writes. Reports contain counts,
canonical cursor and safe categories, not personal metrics or raw source data;
keep even these operator reports private.

Rich Strava reads extract catalog scalar fields from retained detail and validate
its version against the compact source hash. They do not read streams/laps/zones.
Garmin reads current immutable compact summary and at most two bounded FIT
session messages (multiple sessions fail closed), plus resource metadata and
existing compact strength counts. No records/time-series are projected. Missing
or incomplete data is reported; #98 full archive is not required.

## Catalog v1 reference

This reference is rendered from the executable catalog. Bounds apply after normalization; all entries use absent-is-missing semantics. FIT direct fields are recorded; provider summaries/details and strength counts are provider-derived. SportOS pace is explicitly calculated.

| Key | Unit / dimension | Sports | Normalized bounds | Provider fields / source units |
|---|---|---|---|---|
| distance | m / length | walk, run, bike, swim, workout, rowing, sup, hiit | 0–1000000 | strava: `distance` (m); garmin: `distanceM` (m); garmin: `total_distance` (m) |
| elapsed_duration | s / time | walk, run, bike, swim, workout, rowing, sup, hiit | 0–604800 | strava: `elapsed_time` (s); garmin: `elapsedTimeS` (s); garmin: `total_elapsed_time` (s) |
| moving_duration | s / time | walk, run, bike, swim, workout, rowing, sup, hiit | 0–604800 | strava: `moving_time` (s); garmin: `movingTimeS` (s) |
| timer_duration | s / time | walk, run, bike, swim, workout, rowing, sup, hiit | 0–604800 | garmin: `total_timer_time` (s) |
| average_speed | m/s / speed | walk, run, bike, swim, rowing, sup | 0–100 | strava: `average_speed` (m/s); garmin: `avg_speed` (m/s); garmin: `enhanced_avg_speed` (m/s) |
| maximum_speed | m/s / speed | walk, run, bike, swim, rowing, sup | 0–100 | strava: `max_speed` (m/s); garmin: `max_speed` (m/s); garmin: `enhanced_max_speed` (m/s) |
| average_pace | s/km / pace | walk, run, bike, swim, rowing, sup | 0–36000 | same-origin moving duration ÷ distance |
| average_heart_rate | bpm / frequency | walk, run, bike, swim, workout, rowing, sup, hiit | 1–255 | strava: `average_heartrate` (bpm); garmin: `avg_heart_rate` (bpm) |
| maximum_heart_rate | bpm / frequency | walk, run, bike, swim, workout, rowing, sup, hiit | 1–255 | strava: `max_heartrate` (bpm); garmin: `max_heart_rate` (bpm) |
| calories | kcal / energy | walk, run, bike, swim, workout, rowing, sup, hiit | 0–100000 | strava: `calories` (kcal); garmin: `total_calories` (kcal) |
| ascent | m / length | walk, run, bike, swim, workout, rowing, sup, hiit | 0–100000 | strava: `total_elevation_gain` (m); garmin: `total_ascent` (m) |
| descent | m / length | walk, run, bike, swim, workout, rowing, sup, hiit | 0–100000 | garmin: `total_descent` (m) |
| average_temperature | C / temperature | walk, run, bike, swim, workout, rowing, sup, hiit | -100–100 | strava: `average_temp` (C); garmin: `avg_temperature` (C) |
| average_cadence | rpm / cadence | run, bike | 0–300 | strava: `average_cadence` (rpm); garmin: `avg_cadence` (rpm) |
| running_cadence | steps/min / cadence | run | 0–500 | garmin: `avg_running_cadence` (strides/min, ×2) |
| maximum_running_cadence | steps/min / cadence | run | 0–500 | garmin: `max_running_cadence` (strides/min, ×2) |
| maximum_cadence | rpm / cadence | bike | 0–300 | garmin: `max_cadence` (rpm) |
| step_length | m / length | run | 0–5 | garmin: `avg_step_length` (mm, ×0.001) |
| vertical_oscillation | mm / length | run | 0–300 | garmin: `avg_vertical_oscillation` (mm) |
| vertical_ratio | % / ratio | run | 0–100 | garmin: `avg_vertical_ratio` (percent) |
| ground_contact_time | ms / time | run | 0–2000 | garmin: `avg_stance_time` (ms) |
| ground_contact_balance | % / ratio | run | 0–100 | garmin: `avg_stance_time_balance` (percent) |
| stance_time_ratio | % / ratio | run | 0–100 | garmin: `avg_stance_time_percent` (percent) |
| average_power | W / power | run, bike, rowing, sup | 0–10000 | strava: `average_watts` (W); garmin: `avg_power` (watts) |
| maximum_power | W / power | run, bike, rowing, sup | 0–10000 | strava: `max_watts` (W); garmin: `max_power` (watts) |
| weighted_average_power | W / power | bike | 0–10000 | strava: `weighted_average_watts` (W) |
| total_work | kJ / energy | walk, run, bike, swim, workout, rowing, sup, hiit | 0–100000 | strava: `kilojoules` (kJ); garmin: `total_work` (J, ×0.001) |
| aerobic_training_effect | TE / provider_index | walk, run, bike, swim, workout, rowing, sup, hiit | 0–5 | garmin: `total_training_effect` (unitless) |
| anaerobic_training_effect | TE / provider_index | walk, run, bike, swim, workout, rowing, sup, hiit | 0–5 | garmin: `total_anaerobic_training_effect` (unitless) |
| relative_effort | RE / provider_index | walk, run, bike, swim, workout, rowing, sup, hiit | 0–100000 | strava: `suffer_score` (RE) |
| normalized_power | W / power | bike | 0–10000 | garmin: `normalized_power` (watts) |
| training_stress | tss / provider_index | bike | 0–10000 | garmin: `training_stress_score` (tss) |
| pool_length | m / length | swim | 1–200 | garmin: `pool_length` (m) |
| length_count | lengths / count | swim | 0–10000 integer | garmin: `num_lengths` (lengths) |
| active_length_count | lengths / count | swim | 0–10000 integer | garmin: `num_active_lengths` (lengths) |
| lap_count | laps / count | walk, run, bike, swim, workout, rowing, sup, hiit | 0–10000 integer | garmin: `num_laps` (unitless) |
| stroke_count | strokes / count | swim, rowing, sup | 0–100000 integer | garmin: `stroke_count` (counts) |
| stroke_rate | strokes/min / cadence | swim, rowing, sup | 0–300 | garmin: `avg_swimming_cadence` (strokes/min); garmin: `avg_paddlesport_cadence` (strokes/min) |
| strokes_per_length | strokes/length / count | swim | 0–1000 | garmin: `avg_strokes_per_length` (strokes/length) |
| swolf | SWOLF / provider_index | swim | 0–1000 | garmin: `avg_swolf` (unitless) |
| distance_per_stroke | m/stroke / length | swim, rowing, sup | 0–100 | garmin: `avg_stroke_distance` (m) |
| strength_workingSets | count / count | workout | 0–2000 integer | garmin: `workingSets` (count) |
| strength_totalRecordedSets | count / count | workout | 0–2000 integer | garmin: `totalRecordedSets` (count) |
| strength_restMarkers | count / count | workout | 0–2000 integer | garmin: `restMarkers` (count) |
| strength_warmupSets | count / count | workout | 0–2000 integer | garmin: `warmupSets` (count) |
| strength_unknownSets | count / count | workout | 0–2000 integer | garmin: `unknownSets` (count) |
| strength_exerciseCount | count / count | workout | 0–2000 integer | garmin: `exerciseCount` (count) |

## Repeatable validation

The catalog fixtures and provider workflow tests are offline. Run the focused
repository integration against disposable migrated primary/detail databases with
`SPORTOS_OWNER_TEST_DATABASE_URL`, `SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL`,
`SPORTOS_WORKER_TEST_DATABASE_URL` and optionally
`SPORTOS_WORKER_DATA_TEST_DATABASE_URL`. Use their intended non-owner roles.
Never run synthetic integration against personal/production history.

For a disposable populated V128 upgrade test, apply migrations through V128,
run `scripts/activity-metrics-upgrade-fixture.sql` with the separate schema-owner
test identity, apply V129, and run `scripts/verify-activity-metrics-upgrade.sql`.
It compares complete canonical, daily, ledger, snapshot and performance rows and
checks that the migration performs no implicit projection/backfill.

## Activity metrics display (#114)

The feature-owned UI view model groups comparisons into Time & Distance, Heart
Rate, Running Dynamics, Power & Training and Other. It shows one value for
providers within the absolute display tolerances below; every member of a
combined row must agree. A combined row keeps the exact authoritative value
when available. Meaningfully different values remain separate with Strava first.
When values differ, bold styling identifies the canonical or catalog-selected
primary value, explained once above the component. No authority badge is repeated
on individual values. Garmin values filling a display gap are marked Read-only
fallback instead.
Manual/workbook authority is preserved even when both providers disagree.

| Metric | Absolute tolerance (normalized units) |
|---|---|
| Distance | 10 m |
| Elapsed, moving, timer duration | 1 s (separate metrics) |
| Pace | 1 s/km; swimming 1 s/100m |
| Speed | 0.1 km/h |
| Heart rate | 1 bpm |
| Running/cycling/stroke cadence | 1 steps/min, rpm or strokes/min respectively |
| Power | 1 W |
| Calories, ascent/descent, ground contact time, Relative Effort | 1 kcal, m, ms or RE respectively |
| Temperature, vertical oscillation, ratios/balance, Training Effect, training stress, work, SWOLF, strokes/length | 0.1 in the metric's normalized unit |
| Step length, pool length, distance/stroke | 0.01 m or m/stroke |
| Counts and unrecognized metrics | Exact equality |

Durations use m:ss/h:mm:ss; pace uses m:ss /km or /100m for swimming; speed
uses km/h. Swimming distance stays in metres; other distances use metres below
1 km and kilometres thereafter. HR/power/cadence/counts use whole units;
dynamics and provider indices retain their relevant decimal precision.

For runs only, the UI combines general `average_cadence` rpm observations
(cycles/strides per minute ×2) with explicit running cadence already projected
as steps/min. Explicit Garmin running subfields take precedence over generic
Garmin cadence. Cycling remains rpm and is never doubled. See [Strava cadence definitions](https://support.strava.com/en-us/articles/15401948-what-is-cadence-on-strava) for the sport-specific display dimensions. This presentation
conversion changes neither original observations nor persisted catalog units.

Only current provider winners are compared; alternative fields/versions remain
in the unchanged comparison contract. Complete per-metric provenance is accessible
under **Source and provenance → Normalized metric provenance (advanced)**,
separate from the metrics component. Canonical cards omit fields already in the
comparison while retaining steps, effort points and stopped time. Provider data,
normalization, Fetch/View/Refresh and explicit raw-resource access remain intact.
