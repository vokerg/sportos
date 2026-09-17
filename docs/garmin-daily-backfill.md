# Garmin daily backfill

## Current checkpoint

- Exact daily summaries are collected and imported-ready for **2026-05-16 through 2026-09-16**, inclusive.
- The source file is `work/garmin-daily-2026-05-16--2026-09-16.csv` and has 124 data rows.
- 2026-09-17 was deliberately excluded because its Garmin total was still changing during collection.
- The earlier one-year Garmin report remains useful only as weekly evidence. Never divide weekly totals across days.

## Preferred source

Garmin Connect currently exposes exact dated summaries at:

`https://connect.garmin.com/app/steps/YYYY-MM-DD/0`

The page's **Summary** section contains, in order:

1. exact steps;
2. the configured step goal;
3. distance in km;
4. total calories.

Garmin's Account Information page also offers a one-day wellness FIT ZIP export, but on 2026-09-17 its Export action returned Garmin's own `Sorry, something went wrong` error for both old and recent dates. Retry that official route in future; use the dated Steps pages when it remains unavailable.

## Continuation procedure

1. Use the user's already signed-in Garmin Connect browser session. Do not extract or persist browser cookies, passwords, or tokens.
2. Start with the day after the CSV's latest complete date. Do not collect the current day before it is complete.
3. Visit each dated Steps URL and wait until both `Summary` and `Daily Timeline` are present.
4. Capture the exact steps, distance, and total calories. Retry any page that does not expose a complete Summary; do not write a zero for a failed load.
5. Append rows with this exact schema:

   `date,steps,distance_km,total_calories`

6. Verify dates are unique and contiguous before importing.
7. Upload the CSV as `garmin_csv`. It is parsed as `daily_summary`, retained with raw-row provenance, and shown on the matching Daily Log date. Import remains staging-only; an explicit daily recalculation applies it.

## Step recalculation semantics

- A positive manual step fact is authoritative and can only be changed by another manual edit.
- Positive imported or unattributed legacy steps are preserved conservatively.
- Setting steps to zero manually unlocks Garmin resolution on the next recalculation.
- Garmin `daily_summary.steps` is an all-day total. SportOS subtracts estimated steps from every Strava run on that date so running is not scored twice.
- Strava running `average_cadence` values such as `89.2` are normalized to total foot strikes (`178.4 spm`). Estimated run steps are normalized cadence multiplied by moving minutes.
- When cadence is absent, SportOS interpolates a bounded pace-based fallback calibrated to `186 spm` at `4:00/km`, `178 spm` at `5:00/km`, and `172 spm` at `5:39/km`.
- The final canonical step fact is `max(Garmin total − estimated running steps, 0)`. Each run estimate and its cadence source are persisted in the score snapshot and shown in the Daily Log explanation.

## Verification

- Import result should report one Garmin observation per data row and zero warnings.
- Check a few dates through `GET /daily/YYYY-MM-DD/evidence` or the Daily Log UI.
- A daily observation should be labeled **Daily summary** and show exact Steps, Distance, and Total calories.
- After recalculation, the Steps fact should show the Garmin equation and a per-run cadence deduction. Manual/imported step facts should remain unchanged.
