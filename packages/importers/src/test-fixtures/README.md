# Synthetic XLSX fixtures

The importer tests generate real `.xlsx` files at runtime with `xlsx` and read them through the same `readWorkbook` path used by the application.

## Fixture variants

### Daily ledger

`writeMySportFixture` creates:

- `Sheet1` with every documented daily-ledger header;
- valid rows covering steps, indoor/outdoor run and bike, SUP, rowing, HIIT, swim, workout points, power points, aggregate run/bike values, and imported `All` points;
- cached formula values for aggregate bike, aggregate run, and `All`;
- one row with a missing date;
- one unknown column that must remain raw-only;
- an empty `Sheet8`;
- a hidden `Sheet2` helper sheet;
- an unsupported notes sheet.

### Running performance

`writeRunDbFixture` creates one valid event for every confirmed running sheet:

- `5k(sorted`
- `10k(sorted)`
- `12`
- `Лист14`
- `M`
- `Лист11`
- `Лист13`

It also includes treadmill and PR markers, source ranks, a malformed row, the unresolved `Лист12`, a hidden helper sheet, and an unknown-distance sheet.

## Privacy and determinism

All names, dates, measurements, notes, formulas, and marker values are synthetic constants defined in `xlsx-fixtures.ts`. The generators do not read environment variables, local workbooks, network resources, or user data.

Tests write workbooks only to a temporary operating-system directory and remove them after each case. Repository fixtures therefore contain no personal data or machine-specific paths.

Row-hash assertions compare independently generated files. The XLSX ZIP container itself is not used as the determinism boundary; canonical row hashes are derived from sheet name, one-based row index, and extracted cell values.
