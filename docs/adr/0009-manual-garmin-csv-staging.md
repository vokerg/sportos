# ADR 0009: Manual Garmin CSV staging with overlap-safe identity

- Status: Accepted
- Date: 2026-09-17
- Issue: #62

## Context

Garmin data is currently available as manually downloaded CSV reports rather
than a reliable API stream. The observed exports include weekly steps, weekly
calories, weekly floors, and weight/body-composition measurements. Filenames
cannot be trusted as identities: differently named exports can be byte-for-byte
identical, and later files can partially overlap earlier files.

This data may support future calculations, but those semantics have not been
decided. Importing it must not silently change current activities or scores.

## Decision

Garmin CSVs use the existing authenticated upload, external object storage,
durable import job, batch history, and raw `source_records` pipeline.

Exact file duplicates are detected per account and import kind from the file's
SHA-256 digest. The original filename remains display metadata only.

The parser recognizes only the four observed layouts. It accepts UTF-8 with an
optional BOM, validates bounded cells and rows, and retains every non-empty CSV
record. The weight export's date-marker rows provide source-local dates for the
following time rows. No timezone is invented.

Valid observations are projected into `garmin_observations`. Identity is scoped
by account and report type:

- weekly reports use their explicit source date;
- weight/body-composition reports use source-local date, time, and normalized
  measurement fingerprint. Garmin exports can contain distinct measurements in
  the same minute, so timestamp alone is not a safe identity.

An overlapping identical observation is counted as unchanged. A later weekly
row with the same identity and different normalized values updates the current
staging projection. Distinct same-minute body measurements remain separate.
Every old and new raw row remains retained and linked to its staging observation,
so later policy can replay or compare versions.

Garmin CSV jobs write no `activities`, `daily_metrics`, `score_ledger`, or
`daily_score_snapshots` rows. Any promotion into canonical facts or score
recalculation requires a later explicit product and domain decision.

`garmin_observations` is owner scoped with forced RLS, immutable ownership, a
same-owner source-record foreign key, and direct grants only to the app, legacy,
and owner-scoped worker-data roles. The cross-owner dispatcher cannot read or
mutate staged Garmin data.

## Consequences

- Manual exports can be uploaded repeatedly without duplicate staged facts.
- Corrected overlapping values converge while their prior raw evidence remains.
- The system stores source-local timing without claiming an unsupported timezone.
- Future calculation work can start from a stable, replayable staging boundary.
- Staged Garmin observations are intentionally absent from canonical exports and
  current scoring until a separate decision defines their authority and mapping.
