# Rolling dynamics and monthly statistics

SportOS exposes two authenticated read-only longitudinal views over canonical `daily_metrics`:

- **Dynamics** at `/dynamics` shows how trailing 10, 20, 30, 60, and 365-day windows change on every calendar date; and
- **Monthly Stats** at `/monthly-stats` compares calendar-month totals and recorded-day averages.

Neither view adds columns to Daily Log, alters official scores, or promotes workbook formula cells into canonical facts.

## Metrics and units

| Metric | Authoritative source | API unit | Display unit |
| --- | --- | --- | --- |
| Official score | `daily_metrics.total_points` | points | points |
| Steps | `daily_metrics.steps` | steps | steps |
| Run | `daily_metrics.run_m` | metres | kilometres |
| Bike | `daily_metrics.bike_m` | metres | kilometres |
| Swim | `daily_metrics.swim_m` | metres | kilometres |
| Workout | `daily_metrics.workout_points` | points | points |
| Bonus | `daily_metrics.bonus_points` | points | points |

Historical workbook columns such as `A10`, `A20d`, `30(All)`, `A60d`, `A365`, and source-specific 30-day formula columns remain private raw evidence. Dynamics recomputes aggregates from the current canonical daily rows and never treats cached spreadsheet formulas as authority.

## Rolling Dynamics semantics

`GET /dynamics/rolling` requires `from` and `to`, accepts one allowlisted metric, and accepts a unique subset of the fixed 10, 20, 30, 60, and 365-day windows. The repository reads enough canonical history before `from` to calculate the largest selected lookback. The response still exposes points only inside the requested display range.

Every requested calendar date produces a point, even when that date has no daily row. A trailing N-day point includes the selected date and the preceding N−1 calendar dates. Therefore, an activity enters the window on its activity date and expires exactly N days later. For example, a marathon on January 1 contributes to the 30-day value through January 30 and drops out on January 31.

Each window returns its rolling total, average per calendar day, recorded-day coverage, fixed window length, and completeness. Calendar-day average always divides by N. Missing canonical dates are not labelled as zero: incomplete coverage is returned and highlighted because the total and average may be understated. A persisted zero remains a recorded zero.

## Monthly Stats semantics

`GET /dynamics/monthly` requires `from` and `to`, accepts at most 3,660 inclusive calendar days, and rejects unknown query fields. `granularity` is one of `daily`, `weekly`, or `monthly`; `metrics` is a comma-separated subset of the fixed allowlist. Weeks begin on Monday in the source-local calendar-date model already used by SportOS.

Every bucket returns:

- its covered date bounds;
- `calendarDays`, including dates without a canonical daily row;
- `recordedDays`, counting only persisted canonical daily rows;
- a total and recorded-day average for each requested metric; and
- a `partial` marker when the selected range clips a week or month.

No-row days are missing, not zero. A persisted row whose metric value is zero remains a recorded zero. Consequently, `recordedDayAverage` divides by `recordedDays`, never by all calendar days. Coverage is displayed beside every month so sparse history and incomplete current months remain visible.

The Monthly Stats chart supports absolute totals or recorded-day averages. Absolute mixed-unit series use separately labelled axes. Indexed comparison sets each series' first non-zero value to 100; this compares shapes, not physical magnitudes.

Monthly Stats also includes an Excel-style year/month score ledger. Years can be expanded or collapsed; expanded years show each calendar month followed by a year total. Its fixed columns are `Bike`, `Run`, `SwimT`, `Woth`, `stepsT`, `Power`, and `Sum`. The first six columns are summed score-ledger contributions (`bike`, `run`, `swim`, `workout`, `steps`, and `bonus`); `Sum` is the authoritative `daily_metrics.total_points` total. These columns intentionally do not reuse raw distance or raw step totals from the selectable dynamics metrics.

## Ownership and privacy

The controller derives the account only from the authenticated session. Repository access runs inside `withAccountContext`, and forced RLS prevents another account's rows from contributing to buckets. The response contains canonical numeric facts and dates only—no owner IDs, raw payloads, filenames, hashes, formulas, authentication data, or provider credentials.
