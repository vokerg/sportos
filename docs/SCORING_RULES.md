# Scoring rules and reconciliation semantics

This document is the semantic contract for the enabled MVP-0 scoring rules. The database remains the runtime source of enabled rules; this document explains the units, formulas, rounding, thresholds, effective periods, classification, evidence level, and historical recomputation behavior.

## Calculation policy

- Coefficient and manual-point rules calculate `rawPoints = metricValue × coefficient`.
- SportOS rounds **once per rule** with JavaScript `Math.round`, producing an integer ledger contribution.
- Daily base and bonus totals are sums of the already-rounded ledger contributions. SportOS does not sum fractional rule outputs and round only at the end.
- Coefficient/manual rules evaluate synthetic daily aggregates; achievement rules evaluate one canonical activity only. Separate sessions are never combined to cross an achievement threshold.
- Achievement rules award their configured integer points only after every threshold and auxiliary condition passes.
- Rules are active when `validFrom <= metricDate <= validTo`; a missing `validTo` means no configured end date. Both boundaries are inclusive.
- Rule evaluation order is deterministic: ascending `priority`, then ascending rule `code`.
- Coefficient and ordinary manual-point rules are base contributions. Achievement rules and rules whose activity type is `power_bonus` are bonus contributions.
- Every new ledger entry records the input metric, input unit, input value, raw points where applicable, rounding policy, rounded points, classification, rule kind, effective dates, priority, and threshold/auxiliary inputs where applicable.

## Enabled MVP-0 rule catalog

All rules below are effective from `1900-01-01` with no configured end date. That broad effective period reflects the existing seed configuration; it is not proof that every historical workbook used the same coefficients.

| Priority | Code | Classification | Input and formula | Boundary/auxiliary semantics | Evidence status |
| ---: | --- | --- | --- | --- | --- |
| 10 | `steps.base` | Base | steps × 1; nearest integer per rule | none | Confirmed SportOS mapping; steps are imported as an integer count. |
| 20 | `run.km.default` | Base | aggregate run km × 1,000; nearest integer per rule | none | Synthetic workbook formula evidence confirms the configured mapping. Historical coefficient changes remain unproven. |
| 30 | `bike.km.default` | Base | aggregate bike km × 650; nearest integer per rule | none | Configured assumption. No permitted historical workbook evidence currently justifies changing it. |
| 40 | `swim.m.default` | Base | swim meters × 7.5; nearest integer per rule | none | Configured assumption. No permitted historical workbook evidence currently justifies changing it. |
| 50 | `workout.manual` | Base | imported, importer-rounded `WOtotal` points × 1; nearest integer per rule | HIIT and rowing are not added separately | Confirmed application behavior. Whether every workbook's `WOtotal` embeds the same source components remains unresolved. |
| 60 | `power.manual` | Bonus | imported, importer-rounded `Pow` points × 1; nearest integer per rule | none | Confirmed application behavior and activity classification. Migration V102 corrects older base/bonus aggregates without changing daily totals. |
| 70 | `run.5k.sub25.bonus` | Bonus | +1,000 points | one activity: duration strictly `< 1,500 s`; distance within ±500 m of 5,000 m | SportOS rule. It is not assumed to be included in spreadsheet `All`. |
| 80 | `run.10k.completed.bonus` | Bonus | +2,000 points | one activity: distance `>= 10,000 m` | SportOS rule. It is not assumed to be included in spreadsheet `All`. |
| 90 | `swim.1k.sub20.bonus` | Bonus | +1,000 points | one activity: duration strictly `< 1,200 s`; distance `>= 1,000 m` | SportOS rule. It is not assumed to be included in spreadsheet `All`. |
| 100 | `bike.10k.easy.bonus` | Bonus | +1,000 points | one activity: average speed strictly `< 20 km/h`; no separate distance minimum is currently enforced | SportOS rule with an unresolved naming/condition mismatch: the name mentions 10 km, but the current engine has no minimum-distance condition. |

## Spreadsheet component evidence

The daily workbook may provide cached formula columns `Run to S`, `Bike to S`, `sup to s`, `raw to s`, and `Swim to S`. The importer exposes these as reconciliation evidence with their source-column names. They are not canonical activity facts and they do not create scoring rules.

A component comparison is:

- `exact` when the matching SportOS base-rule points equal the imported component value;
- `within_tolerance` only when the caller explicitly supplies a lossy source rounding unit and the delta is at most half that unit;
- `mismatch` when a matching rule exists but the values differ beyond explicit tolerance;
- `unmapped` when no enabled base rule corresponds to the component activity type.

`sup to s` and `raw to s` are currently reported as `unmapped`. SportOS does not add direct SUP or rowing rules because doing so could double count values already represented by `WOtotal`. This is an explicit unresolved mapping, not an omission hidden by tolerance.

## Daily reconciliation classifications

The pure reconciliation report emits one row per date and groups rows by status, delta magnitude, activity type, and evidence-backed likely rule.

- `exact`: app total equals imported spreadsheet total.
- `explained`: the delta is fully explained by a supported policy. Currently this means either the spreadsheet total equals SportOS base points and the delta equals SportOS bonuses, or the delta falls within an explicitly supplied lossy source rounding unit.
- `unresolved`: totals differ and no supported explanation fully accounts for the delta. Candidate rule codes are included only when a mismatching formula component directly maps to those rules.
- `not_comparable`: the workbook row has no cached numeric `All` value.

The default tolerance is **zero**. SportOS never introduces a generic percentage or point tolerance merely to improve match rates.

## Fixture evidence

`docs/evidence/scoring-reconciliation.fixture.json` is a machine-readable summary generated and verified by `packages/importers/src/scoring-reconciliation.fixture.test.ts`. It contains:

- one exact row with exact run, bike, and swim components plus explicitly unmapped SUP/rowing components;
- one row without an imported `All` value;
- one explained difference where a SportOS achievement bonus is excluded from the spreadsheet total;
- one unresolved bike-component mismatch identifying `bike.km.default` as the evidence-backed candidate rule.

Synthetic evidence proves deterministic application behavior and report shape. It does not prove that a personal historical workbook used the same bike or swim coefficients.

## Historical recomputation and migration V102

V102 does not alter any coefficient, threshold, configured points, or effective period. It:

1. assigns deterministic rule priorities;
2. replaces placeholder descriptions with explicit semantic definitions;
3. removes legacy achievement ledger entries with no `activity_id`, because those entries were calculated from synthetic daily aggregates rather than one canonical activity, and reduces persisted bonus/total values by the same amount;
4. moves previously persisted `power.manual` points from `base_points` to `bonus_points` while preserving `total_points`;
5. enriches remaining legacy ledger JSON with classification, rule kind, activity type, effective dates, and priority.

No coefficient-wide historical recomputation is performed. V102 applies only corrections that can be identified conservatively from persisted rule/activity links. Re-importing or explicitly recomputing a date with the current application is recommended when fully enriched raw/rounded calculation inputs are required for older ledger entries.

## Unresolved behavior

The following items remain intentionally unresolved until permitted source evidence is available:

- whether bike used 650 points/km for every historical period;
- whether swim used 7.5 points/m for every historical period;
- which source columns are included in `WOtotal` across workbook versions;
- whether `Pow` is included in every spreadsheet `All` formula;
- whether spreadsheet `All` includes any SportOS achievement bonuses;
- whether the bike bonus should enforce the 10 km minimum implied by its name.

A future rule change must use a new effective period or versioned rule rather than silently tuning current values to reduce deltas.
