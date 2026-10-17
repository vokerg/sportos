# Issue 151: unified distance leaderboard (in progress)

The leaderboard combines original Excel achievements with current measured retained
efforts. Excel 21,100 m is normalized to the 21,097.5 m target only at read/match
time. Original rows and times remain unchanged; 12 km stays retained but excluded.
Algorithm v5 adds measured marathon support using the existing window algorithm.
Historical v4 projections require explicit retained reprocessing.

Reconciliation policy v1 uses the canonical local date, minimum target distance
with the existing bounded tolerance, treadmill compatibility, and summary moving
pace. It never requires streams or reproduces interval time. Pace must be 120–900
s/km. Whole-run average may be up to 15% faster than the historical target pace,
or slower by 15% plus 20% per extra target-length (capped at 45%). Scores are
100 minus absolute percentage pace difference, minus 10 for unknown subtype;
minimum 65 and decisive margin 12. Near scores remain ambiguous. Adjacent-date
candidates are visible for explicit operator review only. No inferred timezone
shift is automatically accepted. Multiple event distances may share one activity.

Automatic replay preserves accepted and operator decisions. Owner-scoped immutable
decisions and mutable heads survive workbook re-imports. The reconciliation lock
serializes candidate inspection and publication with provider reconciliation.

Displayed-time precedence: original Excel, current calculated Strava streams,
current calculated Garmin FIT. One activity/target ranks once; other evidence is
retained as alternatives. Repeated workbook achievements for one activity/target
are alternatives too, with the fastest historical time displayed. Equal times use
date then stable identifier. Whole-run provider performance events and estimates
never rank. Rank is computed from qualified inputs before the output limit.
Coverage is separate; categories can overlap and never imply archive completeness.

## Investigation

Inspected README, ARCHITECTURE, ROADMAP, AUTHENTICATION, AI_ANALYSIS,
FRONTEND_ARCHITECTURE, RUNNING_EFFORTS, ACTIVITIES; ADRs 0001/0005/0006/0010;
all primary migration names and DDL/security inventory through V136, with full
V004/V106 ownership keys/V133 definitions; import-service/run-db/my-sport importers;
performance/running-efforts/activity-metrics repositories; effort projector,
backfill/schema; domain performance/running-efforts and tests; API performance
controller/tests, provider detail service, running efforts service, activity
controller, DB provider and development auth endpoint; Run Lab and performance
transport/models; root/db package scripts, pool, dev/migration/backfill scripts.

Documentation mismatch: prior docs intentionally exclude measured effort rankings;
#151 changes that boundary only for qualified analytical leaderboards. Timing is
pause-excluded analytical evidence, not certified race records. Scoring is unchanged.

## Validation / operations

Implementation and validation are in progress. No live reconciliation or rich
history catch-up has been applied yet. Private aggregate inventory stays local;
no personal measurements, provider payloads, credentials or raw history belong here.
