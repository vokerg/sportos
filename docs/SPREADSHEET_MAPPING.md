# Spreadsheet mapping notes

These notes were derived from the uploaded workbooks during project generation.

## Daily ledger workbook

Visible sheets:

- `Sheet1` — main daily ledger
- `Sheet8` — appears empty in first sampled rows
- `Sheet2` — hidden small helper sheet

Main headers detected in `Sheet1`:

```txt
Date, Steps, R IN, R Out, Bike IN, SUP, HIIT, raw, Bike OUT, WOtotal, Swim, Pow,
Bike, Run, Run to S, Bike to S, sup to s, raw to s, Swim to S, All,
A10, A20d, 30(All), A60d, A365
```

The importer intentionally stores formulas/cached totals separately. The app should progressively replace formula-derived fields with deterministic code and database views.

## Run workbook

Visible sheets:

```txt
5k(sorted
10k(sorted)
12
Лист14
M
Лист11
Лист12
Лист13
```

The performance importer is conservative. `Лист12` is not normalized until distance semantics are confirmed.
