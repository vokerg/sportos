# Garmin rich acquisition: sport policy and FIT dependency audit

## Intent

A Garmin day refresh must check new watch uploads and day metrics without
re-downloading already-retained full activity resources. Full Garmin FIT is
not a requirement for a daily wellness summary, and a compact activity-list
entry alone is *not* a replacement for running dynamics or pool lengths.

The day discovery always retains **all** returned activity identities,
including walking and unsupported types. Automatic rich acquisition uses a
**positive sport whitelist**. An individual canonical activity retains an
explicit **Fetch full Garmin FIT / Redownload full Garmin FIT** action,
independent of that whitelist.

## Automatic acquisition policy (current implementation)

| Garmin Connect type | Day discovery | Auto full FIT if no complete retained bundle | Explicit activity FIT |
|---|---|---|---|
| running / treadmill_running / track_running / trail_running | Yes | Yes | Yes |
| cycling / indoor_cycling | Yes | Yes | Yes |
| lap_swimming / open_water_swimming | Yes | Yes | Yes |
| strength_training | Yes | Yes | Yes |
| walking | Yes | **No** | Yes, for a matched SportOS activity |
| rowing / indoor_rowing / stand_up_paddleboarding | Yes | **No** | Yes, for a matched SportOS activity |
| missing or unfamiliar type | Yes | **No** | Only if the explicit extractor supports the type |

Whitelisting is intentionally conservative. Unknown types never silently cause
FIT downloads. This does not discard the Garmin day list or interfere with
all-day steps. Cached current FIT resources are reused even when the operator
clicks **Refresh Garmin day**; the day and wellness categories are still
refreshed. The activity-page **Redownload full Garmin FIT** remains a genuine
force refresh. Explicit single-activity retrieval can discover/match from a
Strava-backed canonical session; Garmin-only unlinked identities still require
the separate review/matching workflow.

The mutable day attempt metadata includes `autoRichIdentities` so cache-aware
requests can tell which identities require complete rich coverage. Historical
attempts without this field continue the conservative prior check until
their next refresh. Immutable source projections stay unchanged so identical
pre-upgrade source bytes can be reused without a version conflict.

## Complete downstream use-case inventory

| Consumer | Required evidence | Existing reader | Could JSON avoid FIT? | Safe current behavior |
|---|---|---|---|---|
| Day steps, calories, sleep, HRV, recovery, weight, stress | Eight dated day endpoints, not FIT | Garmin day projection / daily scoring | Already yes | Never depend on per-activity FIT |
| Activity discovery / Strava reconciliation | Native ID, sport, start, duration, distance | Garmin day projection, Garmin identity reconciliation | Compact list plus activity metadata | Auto matching continues only for retained whitelist activities |
| Core metrics, running cadence, stride length, vertical oscillation, GCT/balance | FIT `session` plus compact summary | Retained activity metrics projector | Activity summary/extended JSON may suffice; verify field units and coverage | Existing FIT projection unchanged |
| Cycling power, normalized power, training stress, Training Effect | FIT `session` plus compact summary | Retained activity metrics projector | JSON may suffice for some keys; verify individually | Existing FIT projection unchanged |
| Indoor swim pool length, strokes, SWOLF, active length counts | FIT `session` | Metric projector / Swim lengths | Summary JSON may suffice for aggregates | Existing FIT projection unchanged |
| **Each pool length**, idle/rest markers, per-length timings and stroke/SWOLF | FIT `length` messages and `session` | Swim-length parser / activity timeline service | Garmin splits `lapDTOs[].lengthDTOs` may supply lengths; **must verify idle rows, counts, units and exact timer semantics** | Continue FIT until equivalent coverage is proven |
| Running laps (including timer vs elapsed) | FIT `lap` messages | Activity detail Garmin laps | Splits JSON may suffice, but missing time fields must remain missing | Existing FIT laps retained |
| Running best efforts | FIT record stream (time, distance, pauses), or retained Strava streams | Running-effort projector | Activity charts could help only if measured distance/time/paused intervals are trustworthy; summary/laps cannot replace sub-lap efforts | Keep FIT or Strava streaming input |
| Garmin time-series plots: HR, pace, cadence, power, location | FIT `record` messages | Activity timeline service | Garmin activity-chart JSON might supply some metrics with sufficient samples; validate stream completeness | Keep FIT for Garmin timelines |
| Garmin-only route projection / GPS | FIT records; Strava stream/detail preferred when linked | Route projection service | JSON chart/map geometry may work, subject to source privacy/precision policy | Keep FIT where needed, never silently replace redacted Strava maps |
| Strength working sets and workout points | Garmin exercise-sets JSON and versioned compact strength summary | Strength normalization and explicit daily recalculation | **Yes** for sets; FIT remains an ingestion/identity dependency in the current pipeline | Existing complete FIT-backed retention until a JSON-only ingest contract exists |
| Raw provider records, developer FIT fields, original-file provenance | Original FIT/ZIP | Retained resource inspector / advanced activity view | **No**, by definition | Explicit full-FIT action always available |
| Indoor swim distance correction | Manual effective distance plus retained provider evidence | Activity distance correction / score recalculation | No new FIT needed for correction itself | Retained source stays unchanged |

The ordinary activity detail GET reads compact metric projections. Displaying
an activity, viewing an existing map, and recalculating a daily score never
implicitly contact Garmin. Source projection remains provenance-aware; JSON
values must not be passed off as decoded FIT fields.

## JSON-first migration requirements (not implemented in this change)

The preceding table is an **exhaustive gate** for replacing FIT on a whitelisted
sport. To remove default FIT acquisition for that sport, implement a
versioned JSON evidence path and verify, using sanitized real-device comparisons:

1. A bounded, separately retained Garmin activity-detail/splits/charts/sets
   bundle with explicit source origin and freshness. Avoid inventing a FIT
   file or marking a partial JSON record as complete FIT coverage.
2. A normalized adapter for **every** applicable metric, lap, length, effort,
   timeline, route and strength reader. Distinguish Garmin's timer, elapsed
   and moving durations; retain native units and presence/absence semantics.
3. A feature-level coverage contract that explicitly lists what the JSON
   bundle satisfies. A missing required field selects the FIT fallback
   **only for whitelisted sports**. Non-whitelisted sports remain on-demand.
4. Regression fixtures: corrected swim distances, 25 m and 50 m pools, idle
   lengths, paused running, treadmill vs outdoor running, bike power, missing
   sensor data, strength sets, unsupported/unknown Garmin types, and Garmin
   data privacy/redaction.
5. Separate timing of discovery, JSON calls, FIT downloads, decoding,
   retention and projection. Benchmark to prove JSON-first is faster.
6. Continue to expose a force full-FIT action for any supported matched
   activity; this must bypass JSON coverage and cached-version short circuits.

Until these conditions are met **new uncached whitelisted activities still fetch
FIT**. The safe performance improvement in this branch is eliminating
unnecessary refreshes of previously retained full FIT and excluding walking
and other unlisted sports from automatic extraction. It does **not** claim
to have replaced FIT with JSON for running or swimming.
