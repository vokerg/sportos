# Metric dynamics

SportOS exposes a dedicated authenticated **Dynamics** page at `/dynamics`. It is a read-only longitudinal view over canonical `daily_metrics`; it does not add columns to Daily Log, alter official scores, or promote workbook formula cells into canonical facts.

## Metrics and units

| Metric | Authoritative source | API unit | Display unit |
| --- | --- | --- | --- |
| Official score | `daily_metrics.total_points` | points | points |
| Steps | `daily_metrics.steps` | steps | steps |
| Run | `daily_metrics.run_m` | metres | kilometres |
| Bike | `daily_metrics.bike_m` | metres | kilometres |
| Swim | `daily_metrics.swim_m` | metres | kilometres |
| Workout | `daily_metrics.workout_points` | points | points |
| Power | `daily_metrics.power_points` | points | points |

Historical workbook columns such as `A10`, `A20d`, `30(All)`, `A60d`, `A365`, and source-specific 30-day formula columns remain private raw evidence. Dynamics recomputes aggregates from the current canonical daily rows and never treats cached spreadsheet formulas as authority.

## Aggregation semantics

`GET /dynamics` requires `from` and `to`, accepts at most 3,660 inclusive calendar days, and rejects unknown query fields. `granularity` is one of `daily`, `weekly`, or `monthly`; `metrics` is a comma-separated subset of the fixed allowlist. Weeks begin on Monday in the source-local calendar-date model already used by SportOS.

Every bucket returns:

- its covered date bounds;
- `calendarDays`, including dates without a canonical daily row;
- `recordedDays`, counting only persisted canonical daily rows;
- a total and recorded-day average for each requested metric; and
- a `partial` marker when the selected range clips a week or month.

No-row days are missing, not zero. A persisted row whose metric value is zero remains a recorded zero. Consequently, `recordedDayAverage` divides by `recordedDays`, never by all calendar days. Coverage is displayed beside every month so sparse history and incomplete current months remain visible.

The chart supports absolute totals or recorded-day averages. Absolute mixed-unit series use separately labelled axes. Indexed comparison sets each series' first non-zero value to 100; this compares shapes, not physical magnitudes.

## Ownership and privacy

The controller derives the account only from the authenticated session. Repository access runs inside `withAccountContext`, and forced RLS prevents another account's rows from contributing to buckets. The response contains canonical numeric facts and dates only—no owner IDs, raw payloads, filenames, hashes, formulas, authentication data, or provider credentials.
