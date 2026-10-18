# Historical Excel run Activities

Issue #154 fills canonical history where retained daily workbook totals or running
achievements have no canonical run. These are **historical Excel summaries**, not
Strava/TomTom recordings. An absent provider identity does not establish a device.

The explicit local operator command defaults to preview:

```sh
pnpm activities:historical -- --owner ACCOUNT_UUID --from YYYY-MM-DD --to YYYY-MM-DD --limit 100
# After reviewing the private preview:
pnpm activities:historical -- --owner ACCOUNT_UUID --from YYYY-MM-DD --to YYYY-MM-DD --limit 100 --apply
# Continue using the returned date cursor until hasMore is false:
pnpm activities:historical -- --owner ACCOUNT_UUID --from YYYY-MM-DD --to YYYY-MM-DD --cursor YYYY-MM-DD --limit 100 --apply
```

Requires primary V138 and the non-owner app connection. All reads/writes run in
account context; apply reserves the shared account reconciliation transaction lock.
A batch is atomic. Retrying a failed batch or replaying the range converges. No
provider/helper, detail database, score calculation or queue is invoked. Output
contains private dates/source identifiers: keep it local and outside Git.

## Reconstruction policy v1

- Reuse existing Activities; never add a summary to a date that already has a run.
- For a missing date, daily workbook `run_m` supplies the distance. Aggregate-only
  early rows previously lacked the indoor/outdoor fields needed by the normal
  importer. If absent, use the largest eligible achievement distance that date;
  never add 5 km and 10 km records into 15 km of invented workouts.
- This produces one **day summary**, with unknown session count. A daily total
  does not prove that only one workout occurred. Missing start time, GPS, heart
  rate, device and moving time remain null/unknown.
- Derive subtype only from explicit workbook indoor/outdoor columns or unanimous
  positive treadmill markers. Missing `t` does not prove outdoor running.
- Copy an original duration only when an unambiguous full-distance record matches
  the summary within one metre. Never extrapolate subdistance time to a longer
  total. Conflicting durations stay unknown; original achievements remain intact.
  A copied historical duration has an unspecified pause basis, not measured moving
  time. Its exact event UUID is retained privately in activity provenance.
- Link eligible same-day achievements to exactly one compatible Excel-backed run
  with enough distance, allowing several distances to share the same summary.
  Multiple compatible candidates stay unresolved. Keep accepted, rejected and
  previous operator decisions, and never steal a provider/manual workout identity.
- V138 adds the distinct `historical` audited match method. The database verifies
  workbook source provenance, same owner/date, sufficient distance and compatible
  subtype. Ordinary automatic/operator Strava constraints remain intact; no fake
  provider connection or native identifier is created.

The source stays `my_sport_xlsx` or `run_db_xlsx`, with a stable historical-summary
identity, direct retained source record and bounded reconstruction metadata.
Activities list/detail mark these rows explicitly. Choose **All sources** and
**All time** to see them; the existing default Strava/three-month filter remains.

Daily metrics, imported authority, official scores, ledger, snapshots, rules and
existing activities are untouched. Normal explicit recalculation remains a
separate user action and may consume canonical imported facts as usual. Existing
import provenance and historic timing values are never rewritten by this command.
Re-import can refresh raw workbook snapshots; current reconciliation UUIDs remain
stable. Adding provider history later must use normal conservative reconciliation,
not duplicate this historical summary automatically.
