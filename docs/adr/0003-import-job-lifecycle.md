# ADR 0003: Durable asynchronous import-job lifecycle

- Status: proposed
- Date: 2026-07-30
- Issue: #11

## Context

Browser uploads currently validate, store, and import a workbook inside one HTTP request. The import transaction is deterministic and idempotent, but long-running execution is coupled to the API process. Redis already exists in local infrastructure, while authoritative upload, batch, raw-row, and canonical data live in Postgres.

The worker is currently a one-shot local-path CLI. It cannot read uploaded objects because the storage contract/local adapter live inside `apps/api`.

## Decision

### Authoritative state

Postgres is the source of truth for job state. Redis is a bounded wake-up/delivery transport, not the durable job record.

A new `import_jobs` table will link one uploaded file to zero or more import attempts and store:

- job id and uploaded-file id;
- current import-batch id when an attempt has started;
- workbook kind;
- state, phase, and integer progress;
- attempt count and maximum attempts;
- enqueue/availability timestamps;
- lease owner, lease expiry, and heartbeat timestamp;
- cancellation request timestamp;
- started/completed timestamps;
- sanitized terminal error code/message;
- created/updated timestamps.

The intended state machine is:

```text
queued -> running -> succeeded
   |         |  \-> failed
   |         \----> cancelled
   \--------------> cancelled

failed --explicit retry, attempts remaining--> queued
stale running --lease recovery, attempts remaining--> queued
stale running --attempts exhausted----------> failed
```

Terminal states are `succeeded`, `failed`, and `cancelled`.

### Claiming and duplicate delivery

A worker claims a due queued job in Postgres using one transaction and `FOR UPDATE SKIP LOCKED`. Claiming increments the attempt, assigns a unique worker lease, and changes the state to `running`.

Redis delivery contains only a job id and may be duplicated or lost. A delivery is executable only when the Postgres claim succeeds. The worker also periodically scans for due queued jobs so a Redis outage or lost notification does not strand durable work.

Only one unexpired lease may execute a job. Import-level idempotency and transaction behavior remain the second safety layer against duplicate delivery.

### Queue and resource limits

Local defaults:

- maximum queued/non-terminal jobs: 100;
- worker concurrency: 1 unless explicitly configured;
- maximum attempts: 3;
- lease duration: 60 seconds;
- heartbeat interval: 15 seconds;
- stale-job recovery scan: every 30 seconds.

Limits are configuration values with bounded validation. Queue saturation returns an actionable API response rather than accepting unbounded work.

### Progress

`ImportService` will expose a phase observer in addition to the existing failure injector. The job runner maps durable importer phases to monotonic progress:

- `queued`: 0;
- `transaction-started`: 10;
- `raw-stored`: 30;
- `canonical-written`: 65;
- `daily-scored`: 90 when applicable;
- `batch-finalized`: 100.

Every phase update refreshes the lease heartbeat. Job progress is orchestration metadata; import-batch transitions and row diagnostics remain the authoritative import evidence.

### Cancellation

Queued cancellation is immediate: the job becomes `cancelled` and no import batch is created.

Running cancellation is cooperative at importer phase boundaries. A cancellation request is persisted first. The phase observer checks it before continuing and throws a dedicated cancellation signal, causing the active import transaction to roll back. The job becomes `cancelled`. If a batch envelope already exists, it remains inspectable with a sanitized cancellation failure record; no partial raw or canonical rows commit.

Cancellation never kills a process mid-query and never reports success merely because a request was accepted.

### Retry

Only a terminal failed job may be retried, and only while attempts remain. Retry clears terminal error/lease fields, moves the job to `queued`, and reuses the same uploaded object. A retry does not create a second upload metadata row.

Succeeded and cancelled jobs are not silently retried. A cancelled upload can be explicitly submitted as a new job only through a future dedicated action.

### Stale recovery and shutdown

Workers stop accepting new claims on shutdown, finish or cooperatively release active work within a bounded grace period, and close Redis/Postgres connections.

A running job whose lease expires is stale. Recovery clears its lease and either requeues it with an availability delay or marks it failed when attempts are exhausted. The previous process cannot complete the job after losing its lease because terminal updates require the matching lease owner.

### Storage boundary

The storage contract and local adapter will move from `apps/api` to a framework-neutral workspace package usable by both API and worker. The API stores the upload and enqueues a durable job. The worker reads the object by internal key, parses it in memory, and invokes the existing `ImportService.importWorkbook` path.

Storage roots/object keys remain internal and are never returned by job APIs.

### API and web behavior

Planned API surface:

```text
POST   /imports/upload          -> 202 with upload and job id
GET    /import-jobs/:jobId      -> durable state/progress/result reference
POST   /import-jobs/:jobId/retry
DELETE /import-jobs/:jobId      -> request cancellation
```

The API layer will contain future authorization hooks even though the local milestone has one user.

The web UI polls only non-terminal jobs with a bounded interval/backoff, stops on terminal state or component destruction, and provides manual refresh/retry. It does not create an unbounded polling loop.

## Consequences

- Job state and progress survive API, worker, and Redis restarts.
- Redis improves wake-up latency without becoming the audit database.
- The worker becomes a long-running process with explicit concurrency, leases, recovery, and shutdown behavior.
- Storage becomes reusable outside NestJS.
- Running cancellation is phase-boundary cooperative, not immediate process termination.
- The design adds Postgres and Redis coordination complexity, but every terminal decision remains auditable in Postgres.

## Required evidence

Implementation is complete only with tests demonstrating:

- enqueue returns before import execution;
- independent worker success;
- duplicate Redis delivery permits one claim/execution;
- phase progress and terminal state persistence;
- queued and running cancellation semantics;
- retry after failure without duplicate canonical facts;
- worker restart/stale-lease recovery;
- queue-depth and concurrency enforcement;
- bounded UI polling and terminal stop behavior.
