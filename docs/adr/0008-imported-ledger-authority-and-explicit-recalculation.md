# ADR 0008: Imported ledger authority and explicit score recalculation

- Status: accepted
- Date: 2026-08-28
- Issue: maintainer reprioritization of the scoring workflow

## Context

The daily workbook contains a user-authored `All` total. Earlier SportOS imports
used canonical workbook activities and active SportOS rules to calculate every
daily score, which could add bonuses that were not present in the workbook
total. That made an imported ledger look like a disagreement even when the
workbook was the intended authority.

Strava synchronization can also provide canonical activities for a date that
has no workbook daily row or whose imported ledger needs to be replaced. Score
replacement must remain explicit, bounded, account scoped, and auditable.

## Decision

### Two score authorities

When a `my_sport_xlsx` row has a valid numeric `All` value, import it as the
current authoritative score:

- `daily_metrics.score_status = 'imported'`;
- `base_points = All`, `bonus_points = 0`, and `total_points = All`;
- the live `score_ledger` contains one synthetic workbook-total entry for a
  nonzero total, with no rule or activity link; and
- the original workbook source record remains the row's provenance.

This is a representation of the imported total, not a claim that the
workbook's internal component formula is a SportOS rule calculation. Imported
point totals must be finite, non-negative integers because the official score
columns and ledger points are integer values. Raw source retention still
preserves the original row when the value is invalid.

Rows without `All` continue to be calculated during import. Strava ingestion
never silently changes an existing daily score.

### Append-only score history

Migration V112 adds `daily_score_snapshots`. Every repository score write first
appends the score status, facts, ledger JSON, source-record link, and trigger,
then updates the fast current `daily_metrics` read model and replaces the live
ledger. Existing rows are seeded with a `legacy_migration` snapshot; imported
rows receive a second `workbook_import` snapshot representing their promoted
authority. Snapshot rows are owner scoped and append-only for runtime roles.

The current row and live ledger remain the read path for cockpit, analysis, and
exports. The snapshot table is the durable history of replaced official
versions and is not a prompt, raw provider payload, or generated answer.

### Explicit recalculation

`POST /daily/:date/recalculate` is the only workflow that changes an imported
row to calculated. It runs one account-scoped transaction protected by a
per-account/per-date advisory lock:

1. lock the current daily row when it exists;
2. require at least one canonical Strava activity for the selected date;
3. use all canonical activities when a daily row exists, or Strava activities
   only when the row does not exist;
4. clear workbook `All` from the scoring input so active deterministic rules
   calculate base and bonus contributions normally;
5. append a `manual_recalculation` snapshot and replace the current row/ledger;
6. return the validated score breakdown.

If no Strava activity exists, the API returns a bounded `409
STRAVA_DATA_UNAVAILABLE` response and leaves the imported/current score intact.
The same action is available from the Daily Log date control and score
breakdown panel. A successful recalculation changes the visible status to
`calculated` and preserves the Excel total as a comparison reference.

### Rule changes

Rule previews treat imported rows as unchanged with a zero delta. Rule-change
activation still publishes the immutable rule version, but skips imported rows
and reports `datesSkippedImported`. A user must explicitly recalculate those
dates before a rule change can affect their current score. Calculated rows are
recomputed with workbook `All` excluded from the scoring input and receive a
`rule_recomputation` snapshot.

## Consequences

- A workbook import is stable and trustworthy by default, including against
  bonus-rule drift.
- Score recalculation is visible, reversible in history, and never triggered as
  a side effect of Strava sync or rule publication for imported rows.
- A Strava-only date can be promoted into the normal daily read model through
  the same explicit action.
- The live ledger remains simple and fast, while score history grows
  append-only and requires a future retention/account-erasure policy.
- Imported `All` values do not expose a fabricated rule or bonus breakdown;
  the UI labels the synthetic entry as an imported workbook ledger.

## Validation

Evidence includes pure imported-ledger scoring tests, rule-preview tests,
import integration assertions, Strava-only and imported-to-calculated database
integration cases, API date/conflict tests, Angular API/workflow tests, and
privilege assertions preventing the queue dispatcher from reading score
snapshots.
