# ADR 0003: Durable asynchronous import-job lifecycle

- Status: accepted
- Date: 2026-07-31
- Issue: #11

## Context

Browser uploads previously validated, stored, and imported a workbook inside one HTTP request. The import transaction was deterministic and idempotent, but execution was coupled to the API process. The worker was a one-shot local-path CLI and could not read uploaded objects because the storage adapter lived inside `apps/api`.

## Decision

### Authoritative state and delivery

Postgres is the source of truth for job state, progress, cancellation, attempts, and worker leases. The local implementation uses bounded Postgres polling rather than Redis delivery.

This is deliberate:

- queue correctness has one authoritative persistence system;
- no job can be lost because a wake-up notification was lost;
- no new queue dependency or lockfile change is required;
- a future Redis notification may reduce wake-up latency without changing claim or recovery semantics.

The worker scans due queued jobs. Every execution still requires a successful Postgres claim.

### Persistent state machine

`import_jobs` links an uploaded file to its durable execution lifecycle and optional current import batch.

```text
queued -> running -> succeeded
   |         |  \-> failed
   |         \----> cancelled
   \--------------> cancelled

failed --explicit retry, attempts remaining--> queued
stale running --lease recovery, attempts remaining--> queued
stale running --cancellation requested------> cancelled
stale running --attempts exhausted----------> failed
```

Terminal states are `succeeded`, `failed`, and `cancelled`.

The table stores:

- upload and batch identifiers;
- status, phase, and integer progress;
- attempt count and maximum attempts;
- next-attempt timestamp;
- lease owner, expiry, and heartbeat;
- cancellation request timestamp;
- sanitized terminal error;
- result summary;
- lifecycle timestamps.

A partial unique index permits only one queued/running job for an upload.

### Claiming and duplicate delivery

Workers claim work in a transaction using `FOR UPDATE SKIP LOCKED`. Claiming:

- orders by availability and creation time;
- changes the state to `running`;
- increments the attempt;
- assigns the worker lease;
- establishes the lease expiry and heartbeat.

Only the current lease owner may update progress, link a batch, or write a terminal state. A stale worker therefore cannot complete a recovered job. Multiple workers or duplicate scans can produce only one successful claim. Import transaction/idempotency rules remain the second safety layer.

### Queue and resource limits

Local defaults:

- maximum queued/running jobs: 25;
- worker concurrency: 1, configurable and bounded to 1–4;
- maximum attempts: 3, persisted per job and bounded to 1–10;
- lease duration: 60 seconds, configurable and bounded to 15–600;
- worker poll interval: 1,000 ms, configurable and bounded to 100–60,000.

Enqueue and retry take a Postgres advisory transaction lock before counting active work. Saturation returns `503 IMPORT_QUEUE_FULL` rather than accepting unbounded work.

### Progress and batch evidence

Job progress is monotonic orchestration metadata. Current milestones are:

- queued: 0;
- claimed: 5;
- reading upload: 10;
- parsing workbook: 20;
- transaction started: 30;
- raw stored: 45;
- canonical written: 70;
- daily scored: 88 when applicable;
- batch finalized: 95;
- succeeded: 100.

Each phase update refreshes the lease. The job links the import batch when the importer first reports its batch context. Import-batch transitions and row diagnostics remain authoritative evidence for import behavior.

### Cancellation

Queued cancellation is immediate: the job becomes `cancelled` and no import batch is created.

Running cancellation is cooperative. The request persists `cancellation_requested_at` and changes the phase to `cancelling`. The worker checks cancellation before reading, before parsing, and at importer phase boundaries. A cancellation signal raised inside the import attempt rolls back the active transaction; the job then becomes `cancelled`.

After the importer transaction has committed, success wins. The worker does not convert committed canonical work into a cancelled job because a cancellation arrived after the last safe boundary.

### Retry

Only a failed job may be retried, and only while attempts remain. Retry:

- preserves the job and upload identity;
- clears terminal error, lease, result, cancellation, and completion fields;
- resets progress to zero;
- returns the job to `queued`.

Canonical safety comes from the existing transactional/idempotent importer behavior.

### Stale recovery and shutdown

Before claiming new work, workers recover expired running leases using locked, skip-locked rows:

- cancellation requested -> `cancelled`;
- attempts exhausted -> `failed` with `STALE_LEASE`;
- otherwise -> `queued` with recovery metadata.

The long-running worker stops its polling loops on `SIGINT` or `SIGTERM`, stops claiming new work, and closes the database connection. Active work that loses its process is recovered after lease expiry.

### Storage boundary

The framework-neutral `UploadStorage` contract and local adapter live in `packages/importers`, which is already shared by API and worker. The API stores validated bytes and enqueues a job. The worker reads the opaque object key, parses the workbook in memory, and invokes `ImportService.importWorkbook`.

Storage roots and object keys remain internal and never appear in job APIs.

### API and web behavior

Implemented API surface:

```text
POST /imports/upload                 -> 202 with upload metadata and queued job
GET  /imports/jobs/:jobId            -> persisted state/progress/result/batch link
POST /imports/jobs/:jobId/retry
POST /imports/jobs/:jobId/cancel
```

The Angular UI separates upload progress from job progress. It polls active jobs every 1.5 seconds, stops at a terminal state or component destruction, and caps automatic polling at 120 requests. It exposes cooperative cancel and explicit retry controls.

## Consequences

- API requests return after durable enqueue rather than importer execution.
- Job state and progress survive API and worker restarts.
- Independent workers can run with bounded concurrency.
- Lost wake-ups do not strand work because Postgres scanning is authoritative.
- Cancellation is safe and phase-boundary cooperative, not process termination.
- Storage is reusable outside NestJS.
- Postgres now carries queue coordination load; future wake-up acceleration must preserve these claim and lease invariants.

## Evidence

The implementation is validated by tests for:

- HTTP upload returning a queued job;
- single claim under duplicate delivery;
- monotonic phase progress;
- queued and running cancellation;
- failed-job retry using the same durable identity;
- queue-depth enforcement;
- stale-lease recovery;
- an independent worker reading a real stored XLSX, running the transactional importer, linking the batch, and completing the job;
- bounded browser polling and terminal-state behavior;
- existing importer idempotency, rollback, diagnostics, and scoring integration.
