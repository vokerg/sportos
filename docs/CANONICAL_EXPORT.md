# Canonical export format

## Version

The first stable export contract is `sportos.canonical-export.v1`.

The primary format is one UTF-8 JSON document validated by `CanonicalExportBundleSchema` in `packages/shared/src/canonical-export.ts`. A future CSV or archive representation must preserve the same field meanings and declare a separate format/version when it cannot represent the JSON contract losslessly.

## Purpose

The export provides portable canonical and reconciled application data. It is not a workbook backup and does not reproduce hidden spreadsheet formulas, raw cell payloads, storage object keys, local filesystem paths, credentials, or internal worker leases.

Included datasets:

1. daily summaries and reconciliation fields;
2. canonical activities;
3. canonical performance events;
4. explicit source provenance references for every row.

## Envelope

```json
{
  "schemaVersion": "sportos.canonical-export.v1",
  "generatedAt": "2026-07-31T08:00:00.000Z",
  "dateRange": {
    "from": "2026-05-01",
    "to": "2026-05-31"
  },
  "rowCounts": {
    "dailySummaries": 31,
    "activities": 18,
    "performanceEvents": 4
  },
  "dailySummaries": [],
  "activities": [],
  "performanceEvents": []
}
```

Dates are ISO `YYYY-MM-DD`. Timestamps are ISO 8601 strings with an explicit UTC offset. `from` and `to` are inclusive. Declared row counts must exactly match each dataset.

## Provenance

Every exported row has one strict provenance object:

| Field | Meaning |
|---|---|
| `status` | `available`, `missing`, or `unsupported` |
| `sourceRecordId` | retained raw source-record UUID, or `null` |
| `sourceRecordHash` | source row hash, or `null` |
| `importBatchId` | import-batch UUID, or `null` |
| `source` | source/batch descriptor, or `null` |
| `sheetName` | workbook sheet when applicable, or `null` |
| `rowIndex` | one-based source row when applicable, or `null` |
| `filename` | sanitized source filename, or `null` |

`available` requires both a source-record UUID and import-batch UUID. `missing` means SportOS expected provenance but cannot currently resolve it. `unsupported` means the source type does not provide that provenance concept. Missing fields are represented with `null`; they are never silently omitted or inferred.

## Daily summaries

Each daily row contains:

- canonical facts: `steps`, `runM`, `bikeM`, `swimM`, `workoutPoints`, `powerPoints`;
- persisted official totals: `basePoints`, `bonusPoints`, `totalPoints`;
- spreadsheet comparison: `excelAllPoints`, `pointsDeltaVsExcel`, and `reconciliationStatus`;
- persisted rolling summaries: `avg10d`, `avg20d`, `avg30d`, `avg60d`, `avg365d`;
- `recomputedAt` and source provenance.

Reconciliation status is one of:

- `exact` — app and spreadsheet totals match;
- `explained` — the delta is supported by explicit scoring evidence;
- `unresolved` — totals differ without sufficient evidence;
- `not_comparable` — no numeric spreadsheet total is available.

## Activities

Activity rows contain the canonical activity UUID, date/time, type/subtype, source identity, distance/duration/movement, steps, calories, heart rate, elevation, speed/pace, manual effort points, notes, and provenance.

Nullable values stay `null`; zero is reserved for a measured/configured zero. Raw importer payloads are excluded.

## Performance events

Performance rows contain the canonical event UUID, optional linked activity UUID, event date, source, distance, duration, pace, treadmill/race/PR markers, source rank, tags, notes, and provenance.

The export does not derive new rankings or trend values. Consumers may calculate presentation views from the canonical event fields.

## Stability rules

- Existing v1 field meanings do not change.
- Additive optional fields require a documented compatibility decision; required or semantic changes require a new schema version.
- Unknown top-level or row fields are rejected by the v1 runtime schema.
- Export generation must validate the complete bundle before sending it.
- Filters must be validated and applied deterministically using inclusive date boundaries.
- Rows must use stable ordering: date then UUID for daily/activity/event datasets as applicable.
- Export tests must trace representative rows back to canonical database records and provenance identifiers.

## Privacy

Exports may contain personal training data and sanitized source filenames. They intentionally omit storage keys, server paths, raw workbook rows, workbook formulas, hashes of complete uploaded files, secrets, and authentication data.

Hosted export requires ownership authorization and an audited download policy before multi-user deployment.
