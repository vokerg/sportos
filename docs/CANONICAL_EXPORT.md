# Canonical export format

## Version

The first stable export contract is `sportos.canonical-export.v1`.

The primary format is one UTF-8 JSON document validated by `CanonicalExportBundleSchema` in `packages/shared/src/canonical-export.ts`. A future CSV or archive representation must preserve the same field meanings and declare a separate format/version when it cannot represent the JSON contract losslessly.

## Purpose

The export provides portable canonical and reconciled application data. It is not a workbook backup and does not reproduce hidden spreadsheet formulas, raw cell payloads, upload hashes, storage object keys, local filesystem paths, credentials, or internal worker leases.

Included datasets:

1. daily summaries and reconciliation fields;
2. canonical activities;
3. canonical performance events;
4. explicit source provenance references for every row.

## Request boundary

`GET /exports/canonical?from=YYYY-MM-DD&to=YYYY-MM-DD`

Both dates are required, real calendar dates, inclusive, and ordered. The local endpoint accepts at most 3,660 days in one request. Invalid dates, reversed ranges, and excessive spans return stable `400` errors before a repository query runs. Responses use `Cache-Control: no-store` and an attachment disposition.

## Envelope

```json
{
  "schemaVersion": "sportos.canonical-export.v1",
  "generatedAt": "2026-08-01T08:00:00.000Z",
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

Dates are real ISO `YYYY-MM-DD` values. Timestamps are ISO 8601 strings with an explicit offset. Declared row counts must exactly match each dataset, and every row date must fall within the envelope range.

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

`available` requires both a source-record UUID and import-batch UUID. `missing` means SportOS expected provenance but cannot currently resolve a complete source-record/batch chain. `unsupported` means the source type, such as a manual record, does not provide that provenance concept. Non-available provenance cannot claim traceable source-record or batch UUIDs. Values are never silently inferred.

## Daily summaries

Each daily row contains:

- canonical facts: `steps`, `runM`, `bikeM`, `swimM`, `workoutPoints`, `powerPoints`;
- persisted official totals: `basePoints`, `bonusPoints`, `totalPoints`;
- spreadsheet comparison: `excelAllPoints`, `pointsDeltaVsExcel`, and `reconciliationStatus`;
- persisted rolling summaries: `avg10d`, `avg20d`, `avg30d`, `avg60d`, `avg365d`;
- `recomputedAt` and source provenance.

Reconciliation status is one of:

- `exact` — app and spreadsheet totals match;
- `explained` — reserved in v1 for a future persisted explanation classification;
- `unresolved` — totals differ without a persisted explanation classification;
- `not_comparable` — no numeric spreadsheet total is available.

The current repository emits `exact`, `unresolved`, or `not_comparable`; it does not promote a delta to `explained` from UI-only or inferred evidence.

## Activities

Activity rows contain the canonical activity UUID, date/time, type/subtype, source identity, distance/duration/movement, steps, calories, heart rate, elevation, speed/pace, manual effort points, notes, and provenance.

Nullable values stay `null`; zero is reserved for a measured/configured zero. Raw importer payloads are excluded.

## Performance events

Performance rows contain the canonical event UUID, optional linked activity UUID, event date, source, distance, duration, pace, treadmill/race/PR markers, source rank, tags, notes, and provenance.

The export does not derive new rankings or trend values. Consumers may calculate presentation views from canonical event fields.

## Assembly and ordering

`CanonicalExportRepository` opens one repeatable-read transaction, reads daily, activity, and performance rows from that single snapshot, joins source records and import batches, normalizes PostgreSQL dates/timestamps/numeric values, maps reconciliation/provenance status, and validates the complete document before returning it. A concurrent import or rule recomputation therefore cannot produce a mixed pre/post-commit bundle.

Stable ascending ordering is:

- daily summaries: `metricDate`;
- activities: `activityDate`, then activity UUID;
- performance events: `eventDate`, then event UUID.

The shared schema rejects out-of-range rows, unstable ordering, count mismatches, impossible dates, contradictory provenance, and undeclared fields.

## Stability rules

- Existing v1 field meanings do not change.
- Additive optional fields require a documented compatibility decision; required or semantic changes require a new schema version.
- Unknown top-level or row fields are rejected by the v1 runtime schema.
- Export generation validates the complete bundle before sending it.
- Filters are validated and applied deterministically using inclusive date boundaries.
- Database-backed tests trace representative exported rows to exact canonical, source-record, activity, event, and import-batch UUIDs.

## Privacy

Exports may contain personal training data and sanitized source filenames. They intentionally omit:

- storage keys and server paths;
- raw workbook rows and formulas;
- importer raw payload JSON;
- hashes of complete uploaded files;
- source bytes, credentials, and authentication data.

Integration tests insert forbidden raw/formula/hash values and assert they do not appear in serialized output.

Hosted export requires ownership authorization, an audited download policy, and likely streaming or durable delivery before multi-user deployment.
