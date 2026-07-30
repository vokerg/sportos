# Spreadsheet mapping notes

These notes define the workbook semantics currently recognized by SportOS. The mappings are conservative: raw rows are retained by the import pipeline, while unknown columns, sheets, or malformed rows produce warnings and do not create invented canonical facts.

Synthetic fixture coverage lives in `packages/importers/src/test-fixtures/xlsx-fixtures.ts`. The fixtures contain no personal data and are generated as real XLSX files during tests.

## Daily ledger workbook

### Sheet roles

- `Sheet1` — main daily ledger and the only normalized daily sheet.
- `Sheet8` — known empty/auxiliary sheet; retained during extraction and ignored during daily normalization.
- `Sheet2` — known hidden helper sheet; retained during extraction and ignored during daily normalization.
- Any other sheet — retained during extraction and reported as an unknown daily-ledger sheet.

### Known headers

```txt
Date, Steps, R IN, R Out, Bike IN, SUP, HIIT, raw, Bike OUT, WOtotal, Swim, Pow,
Bike, Run, Run to S, Bike to S, sup to s, raw to s, Swim to S, All,
A10, A20d, 30(All), A60d, A365
```

Header matching trims whitespace, lowercases text, replaces whitespace with underscores, and removes punctuation. For example, `R IN` becomes `r_in` and `30(All)` becomes `30all`.

Unknown headers are preserved in the extracted raw row but are not normalized. The parser emits one deterministic warning per unknown normalized header.

### Canonical fields

| Source header | Canonical interpretation | Unit/behavior |
| --- | --- | --- |
| `Date` | activity/metric date | Excel serial date converted to `yyyy-mm-dd` |
| `Steps` | daily steps and steps activity | integer count, rounded |
| `R IN` | treadmill run activity | kilometers converted to meters |
| `R Out` | outdoor run activity | kilometers converted to meters |
| `Bike IN` | indoor bike activity | kilometers converted to meters |
| `Bike OUT` | outdoor bike activity | kilometers converted to meters |
| `SUP` | outdoor SUP activity | kilometers converted to meters |
| `raw` | indoor rowing effort | rounded effort points; the historical header spelling is preserved |
| `HIIT` | manual HIIT effort | rounded effort points |
| `Swim` | swim activity and daily swim total | meters |
| `WOtotal` | workout activity and daily workout total | rounded points |
| `Pow` | power-bonus activity and daily power total | rounded points |
| `Bike` | daily aggregate bike distance | kilometers converted to meters; falls back to `Bike IN + Bike OUT` when absent |
| `Run` | daily aggregate run distance | kilometers converted to meters; falls back to `R IN + R Out` when absent |
| `All` | imported spreadsheet total | numeric cached value when available; not recalculated by the XLSX parser |

`A10`, `A20d`, `30(All)`, `A60d`, and `A365` are recognized historical/formula columns but are not normalized into canonical facts. They remain available in the raw payload.

Rows with data but without a positive numeric `Date` are retained by raw extraction, skipped by normalization, and reported with a deterministic row warning.

Formula cells are read with formulas preserved in the workbook object and cached numeric values exposed to row normalization. The parser consumes the cached value for `Bike`, `Run`, and `All`; authoritative SportOS scoring remains deterministic application logic rather than spreadsheet formula execution.

### Scoring evidence columns

`Run to S`, `Bike to S`, `sup to s`, `raw to s`, and `Swim to S` are recognized as cached spreadsheet scoring evidence. For each valid dated row, the importer exposes available values with:

- the normalized activity type;
- the original normalized source-column name;
- the imported numeric points;
- the workbook sheet and row location.

These values are not canonical facts and are not automatically persisted as new rules. They are inputs to the pure reconciliation report described in [SCORING_RULES.md](SCORING_RULES.md).

Current mapping status:

| Source column | Evidence activity type | Current handling |
| --- | --- | --- |
| `Run to S` | `run` | compared with enabled run base-rule points |
| `Bike to S` | `bike` | compared with enabled bike base-rule points |
| `Swim to S` | `swim` | compared with enabled swim base-rule points |
| `sup to s` | `sup` | reported as unmapped; no direct SUP scoring rule is enabled |
| `raw to s` | `rowing` | reported as unmapped; no direct rowing scoring rule is enabled |

SportOS does not infer that unmapped SUP or rowing values should be added to `All`. They may already be represented by `WOtotal`, and adding them independently could double count. The relationship between `HIIT`, `raw`, `WOtotal`, and historical workbook formulas remains unresolved.

The synthetic fixture uses coherent cached formulas for run, bike, swim, and `All` according to the current configured rules. That proves parser and reconciliation behavior, not that every historical workbook used the same bike or swim coefficients.

## Running-performance workbook

### Confirmed sheet mapping

| Sheet | Distance |
| --- | ---: |
| `5k(sorted` | 5,000 m |
| `10k(sorted)` | 10,000 m |
| `12` | 12,000 m |
| `Лист14` | 21,100 m |
| `M` | 42,195 m |
| `Лист11` | 5,000 m |
| `Лист13` | 10,000 m |
| `Лист12` | unresolved; never normalized |

A sheet name containing `5k`, `10k`, or `21`, or exactly matching `12` or `M`, may also be inferred conservatively by the domain helper. Other sheet names are retained as raw rows and reported as having no confirmed distance mapping.

### Row interpretation

- Column 1 — Excel time fraction converted to rounded duration seconds.
- Column 2 — Excel serial date converted to `yyyy-mm-dd`.
- Columns 3–10 — optional markers and metadata.
- Marker `t` (case-insensitive) — treadmill event.
- Marker `*` — explicit PR marker.
- Positive integer marker below 1,000 — source rank; the last matching marker wins.
- Other markers — preserved as event tags.

The normalized pace is calculated deterministically from duration seconds and mapped distance. Race status is currently `false`; no workbook marker has been confirmed as an authoritative race indicator.

A first row labeled as a time/date header is ignored. Other nonblank rows with a missing, nonnumeric, or nonpositive time/date are retained by raw extraction, skipped by normalization, and reported with a deterministic row warning.

## Fixture-backed cases

The synthetic harness covers:

- every known daily-ledger header and every confirmed running sheet;
- visible, empty, hidden/helper, unsupported, and ambiguous sheets;
- formula cells with cached aggregate, component-score, and imported-total values;
- indoor/outdoor/treadmill distinctions;
- PR markers, source ranks, dates, distances, durations, and pace;
- comma-decimal numeric text;
- missing-date and missing-time rows;
- unknown columns and sheets;
- stable raw-row hashes across independently generated fixtures;
- exact, explained, unresolved, and non-comparable scoring reconciliation cases.

The fixture harness demonstrates parser, scoring, and reconciliation behavior only after the repository test suite passes. It does not establish that unresolved personal historical workbook coefficients match the configured assumptions.
