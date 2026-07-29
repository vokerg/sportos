# ADR 0001: Import transactions and duplicate identity

- Status: Accepted
- Date: 2026-07-29
- Decision owners: SportOS maintainers
- Related issue: #5

## Context

A workbook import previously committed its batch, raw rows, activities or performance events, daily metrics, score ledger, and final batch status through independent repository calls. A failure could therefore leave a partially normalized workbook. Re-importing the same workbook also appended activities and performance events because canonical rows had no enforced cross-batch identity.

SportOS needs both auditability and convergence:

- every successful import must retain its batch-scoped raw rows;
- canonical facts must not multiply when identical source rows arrive again;
- failed attempts must remain diagnosable without exposing local paths or raw personal cells;
- scoring must be replaced deterministically for only the affected dates.

## Decision

### Transaction boundary

Each workbook is one logical import and receives one `import_batches` row.

1. The batch row is created and committed before canonical processing begins. This row is the durable failure envelope.
2. Raw `source_records`, canonical upserts, affected-date scoring, ledger replacement, provenance links, counts, and the successful final batch status execute in one Kysely/Postgres transaction.
3. Any exception rolls back that entire transaction.
4. After rollback, the durable batch row is marked `failed` in a separate statement with a sanitized phase, error name/message, and attempted counts.

Consequently, a failed attempt retains batch metadata and the original file hash but does **not** retain partially written raw rows. This avoids a batch whose raw and canonical state disagree. The source workbook remains the retry input. Successful attempts always retain raw rows before their canonical facts.

When a request contains both supported workbooks, each workbook has its own batch and transaction. One workbook can therefore succeed independently of the other.

### Duplicate identity

Raw rows are intentionally batch-scoped. Their uniqueness is:

```text
(import_batch_id, source_record_key, row_hash)
```

A repeated successful import creates a new batch and a new set of raw records, preserving import history.

Canonical identities are independent of the batch:

- A daily metric is identified by `metric_date`, the existing primary key. Its `source_record_id` is updated to the source row used for the latest successful recomputation.
- A workbook activity is identified by `source` plus a SHA-256 hash of:
  - the raw source row hash;
  - the canonical entity kind `activity`;
  - activity type;
  - activity subtype.
- A running performance event is identified by `source` plus the raw source row hash because one confirmed running row produces at most one performance event.

The migration installs unique indexes for these identities. Repository writes use `ON CONFLICT ... DO UPDATE`, so a retry updates/reuses the canonical row and returns its stable database ID.

### Provenance

New activities, daily metrics, and performance events store `source_record_id`.

A daily-ledger source row may produce one daily metric and several activities. The source record's single normalized-entity pointer is assigned to the daily metric, while each activity directly points back to the same source record.

A running source record points to its performance event. Re-imported raw records are linked to the same canonical entity returned by the upsert.

Rows created before this decision are backfilled where the existing raw payload permits an unambiguous match. Nullable provenance remains a documented exception for historical rows that cannot be reconstructed safely; the migration does not invent a source link.

### Scoring and retries

Only dates present in the parsed daily workbook are recomputed. Scoring reads the complete canonical activity set for those dates, then replaces each date's ledger inside the workbook transaction.

A retry after a failure follows the same path as a clean import. A retry after success creates another auditable batch/raw snapshot but converges on the same activities, daily metrics, performance events, and ledger contributions.

## Consequences

### Positive

- Failed imports cannot leave partial canonical or ledger state.
- Identical workbook rows converge on stable canonical IDs.
- Later batches remain auditable without becoming canonical duplicates.
- Failure metadata is actionable and excludes filesystem paths and raw cells.
- Failure injection can exercise every major transaction phase in database integration tests.

### Trade-offs

- Failed attempts retain only batch/file metadata, not raw rows, because raw and canonical writes share the rollback boundary.
- Canonical rows point to the latest successful source record; earlier batches remain connected through their normalized source-record pointers.
- Historical provenance backfill is best-effort and intentionally conservative.
- Postgres migrations and database-backed tests are required to validate the behavior; unit tests alone are insufficient.

## Recovery and forward fixes

Flyway remains append-only. If the migration encounters historical data that cannot satisfy a new uniqueness rule, operators should preserve a backup, inspect the duplicate rows, and apply a new forward migration rather than editing this migration after it has run.
