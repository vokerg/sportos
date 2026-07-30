# ADR 0002: Upload storage and source-file retention

- Status: accepted
- Date: 2026-07-30

## Context

The original browser workflow accepted server-local filesystem paths. That is acceptable for a developer CLI but unsafe and unusable as a product boundary. Uploaded workbooks must remain available for provenance and retry work without placing opaque binary blobs in Postgres or exposing server paths through API responses.

## Decision

1. The API accepts one explicitly typed XLSX workbook per multipart request at `POST /imports/upload`.
2. Uploads are limited to 20 MB and validated by extension, MIME signal, ZIP signature, and successful workbook parsing before storage or import execution.
3. Uploaded bytes are stored through the `UploadStorage` contract. The local adapter writes mode-`0600` files beneath `SPORTOS_UPLOAD_DIR` using opaque object keys; API contracts never contain the storage root or resolved path.
4. Postgres stores upload metadata in `uploaded_files`, including workbook kind, safe filenames, content type, byte size, SHA-256 fingerprint, storage provider/key, lifecycle status, and timestamps. Workbook bytes are not stored in Postgres.
5. `import_batches.uploaded_file_id` links source-file lifecycle to the existing raw-row and canonical provenance graph.
6. Duplicate detection compares SHA-256 plus workbook kind against non-deleted uploads before storage and import. The API returns `409 DUPLICATE_UPLOAD` with the existing safe upload/batch reference.
7. Validated bytes are parsed in memory and passed to the existing transactional importer as a `WorkbookExtract`. Import semantics do not depend on a local storage path, so a future object-storage adapter can preserve the same importer boundary.
8. A storage or metadata failure removes any newly written object and starts no import. An import failure retains the object, marks the upload failed, and leaves the durable failed batch available for diagnostics.

## Retention and deletion

For the local single-user milestone, uploaded source files and metadata are retained indefinitely by default. No UI or automated pruning job deletes source files. This preserves deterministic reprocessing and auditability while deletion semantics are still local-operator concerns.

Deletion must be explicit and coordinated:

- remove or archive the storage object;
- mark the metadata row `deleted` with `deleted_at`;
- preserve existing import batches and canonical provenance; the batch foreign key uses `ON DELETE SET NULL` only for an explicit metadata-row deletion;
- never infer deletion from an import failure, duplicate response, browser navigation, or history cleanup.

A hosted/multi-user implementation must add owner scoping, object-store encryption/access controls, lifecycle policy, backup behavior, and an audited deletion workflow before changing this retention policy.

## Consequences

- Local development gains a usable browser upload flow without making local paths public.
- Postgres remains queryable and compact because binary content is external.
- Duplicate detection is advisory under concurrent requests; a future hosted implementation may add an owner-scoped uniqueness or reservation strategy.
- The current local adapter is intentionally simple and not a distributed object store.
