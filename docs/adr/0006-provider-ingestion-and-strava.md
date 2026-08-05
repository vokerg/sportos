# ADR 0006: Provider ingestion framework and Strava adapter

- Status: accepted
- Date: 2026-08-04
- Issue: #15

## Context

SportOS already supports account-scoped workbook ingestion with durable jobs, raw-before-normalized provenance, deterministic scoring, and split queue-dispatch/owner-data authorization. Provider synchronization introduces different risks:

- authorization and revocation are independent of SportOS sign-in;
- access and refresh tokens must be recoverable by background work without being stored or exposed as plaintext;
- backfills and incremental syncs require durable pagination, cursors, leases, retries, cancellation, and rate-limit handling;
- provider records can overlap workbook activities;
- raw provider snapshots must be retained before canonical writes;
- the queue dispatcher must not gain access to credentials or canonical data;
- provider-specific HTTP behavior must remain outside scoring and canonical domain logic.

The first adapter targets Strava, but the persistence and orchestration boundaries are provider-neutral enough to support additional adapters later.

## Decision

### Framework-neutral adapter and cipher boundary

Provider contracts, the Strava adapter, transport abstraction, credential cipher, and pure tests live in `packages/importers` beside the existing external-ingestion contracts. A separate workspace package was considered but rejected for this milestone because the existing package already owns source adapters and is linked into both API and worker processes without changing the workspace dependency graph.

The adapter contract exposes authorization URL creation, authorization-code exchange, refresh, revoke, paginated activity retrieval, and individual activity retrieval. The adapter:

- validates provider responses and bounded numeric/text fields;
- converts provider errors into sanitized stable classifications;
- exposes raw JSON and rate-limit metadata to orchestration;
- never selects an owner, writes Postgres, creates canonical facts, or manages leases.

The Strava HTTP transport rejects redirects, applies a 30-second timeout, and bounds response bodies to 5 MiB. Endpoint base URLs are configuration values rather than scattered constants.

### Credential encryption and rotation

Provider credentials are encrypted before persistence with AES-256-GCM.

Deployment supplies a key ring and one active key ID. Each key is exactly 32 random bytes. The key ring is available only to the API provider service and owner-scoped provider worker; it is not stored in Postgres, returned to the browser, included in exports, or logged.

Each envelope stores:

- key ID;
- algorithm and envelope version;
- random nonce;
- ciphertext;
- authentication tag;
- creation and rotation timestamps.

Additional authenticated data binds the envelope to the owner UUID, connection UUID, provider code, and envelope version. Moving ciphertext to another owner or connection therefore fails authentication.

Refresh responses may rotate the refresh token. The worker decrypts the current envelope, refreshes when expiry is near, and atomically replaces the encrypted access and refresh credentials plus expiry metadata. Refresh responses that omit the athlete object retain the existing immutable provider account identity and granted scopes.

Old keys remain in the configured key ring until all envelopes encrypted with them have been rotated. New and refreshed credentials use the active key.

### Durable persistence

Flyway V109 adds the following tables.

#### `provider_connections`

Account-owned user-visible metadata:

- provider and immutable provider account identity;
- safe display label and granted scopes;
- connection status;
- access-token expiry without token material;
- successful incremental high-watermark;
- last success, last attempt, and sanitized error fields;
- created, updated, disconnected, and revoked timestamps.

The first milestone supports one Strava connection per SportOS account. A provider account may not be attached to multiple SportOS accounts.

#### `provider_credentials`

One encrypted credential envelope per connection. The table is force-RLS protected and directly granted only to `sportos_app` and `sportos_worker_data`. It is explicitly unavailable to shared data roles, the legacy role, and the cross-owner dispatcher.

#### `provider_oauth_transactions`

One-time SHA-256-backed OAuth state tied to the authenticated owner, provider, safe return path, and expiry. Callback completion requires the same authenticated account that initiated the flow.

#### `provider_sync_jobs`

A Postgres-authoritative queue separate from upload-only import jobs. It stores:

- owner, connection, and sync mode;
- queued/running/succeeded/failed/cancelled state;
- phase, progress, attempt budget, lease, heartbeat, and cancellation request;
- frozen requested bounds;
- durable page/count/high-watermark cursor;
- linked import batch;
- sanitized error and bounded result JSON.

Only one queued or running job may exist per connection. Queue capacity is bounded. Claims use the existing narrow dispatcher role; execution uses a separate owner-scoped worker-data connection.

Rate-limit rescheduling persists the committed page cursor, sets the next eligible attempt, releases the lease, and restores the attempt consumed by the claim. Both thrown 429 responses and successful responses whose published usage reaches a limit follow this path.

#### `provider_activity_links`

A same-owner mapping from `(connection_id, provider_activity_id)` to one canonical activity and the latest source snapshot. Provider-native identity is stable across edits. Raw content changes are represented by the source-record hash rather than by changing canonical provider identity.

#### `provider_webhook_events`

V109 reserves a bounded deduplicated inbox schema for future verified webhook receipt and processing. Issue #15 does **not** expose a webhook receiver or background inbox processor. Initial backfill and incremental reconciliation are initiated through authenticated API/UI actions. Webhook verification, deauthorization processing, and targeted delete/private reconciliation remain follow-up work.

### Authorization and database roles

All provider-owned tables use non-null owner IDs, same-owner foreign keys where applicable, immutable-owner triggers, and forced row-level security.

The migration first revokes inherited/default access and then grants exact privileges. It contains migration-time assertions that:

- `sportos_worker_data` can read and rotate owner-scoped credentials;
- `sportos_worker` can inspect and transition provider queue rows;
- `sportos_worker` cannot read provider connections, credentials, source records, or canonical activities.

The browser never supplies an owner or provider account ID as authority. Controllers derive the owner from the authenticated session. Foreign and nonexistent connection/job UUIDs remain indistinguishable through owner-scoped queries.

### Raw-before-normalized synchronization

A provider job creates an `import_batches` row with source kind `strava` and source `strava_api`. Each provider activity is processed as follows:

1. validate and bound the provider representation;
2. retain a raw `source_records` snapshot with provider activity ID and deterministic content hash;
3. map only explicitly supported activity types and fields;
4. resolve an existing provider link, an exact cross-source candidate, an ambiguous collision, or a new canonical activity;
5. write/update the provider link and source-to-canonical provenance;
6. create or update a provider performance event only for a provider-owned supported run;
7. commit batch counts and job cursor after the page has committed.

Unsupported activities remain raw source rows with warnings. Ambiguous exact candidates are retained as skipped `POTENTIAL_DUPLICATE` rows and do not create a second canonical fact.

For an existing workbook/manual activity, an exact match requires the same canonical type, local activity date, exact UTC start instant, distance (including explicit null semantics), and moving duration. A single match receives a provider link while retaining its original source fields and values. Multiple matches are never guessed.

Repeated pages, retries, incremental overlap, and provider edits converge through `(owner, connection, provider_activity_id)`. Raw snapshots may repeat across different batches, but canonical facts and provider links remain stable.

### Pagination, cursors, and high-watermarks

The adapter requests at most 200 activities per page and continues until an empty page. An initial backfill freezes an upper bound. An incremental sync starts six hours before the last successful high-watermark to safely reread boundary updates.

The job cursor stores the next page, counts, and the maximum observed activity start instant. A retry or rate-limit resume starts from that cursor. A successful empty incremental run preserves the connection’s previous high-watermark instead of clearing it.

The independent worker uses bounded concurrency, polling, leases, heartbeats, stale recovery, cooperative cancellation, and graceful process shutdown. Provider execution is enabled only when all Strava and credential-key settings are present.

### Disconnect and retention

Authenticated disconnect serializes through the connection row, attempts provider revocation, deletes the encrypted credential regardless of an idempotent provider not-found response, cancels queued jobs, requests cancellation of running work, and marks the connection disconnected.

Disconnect does not delete retained import batches, raw snapshots, provider links, canonical facts, performance events, scores, or audit history. Account erasure remains a separate explicit lifecycle.

### API and browser boundary

Authenticated routes provide:

- start Strava authorization and complete the callback;
- list safe connection metadata;
- enqueue initial backfill or incremental sync;
- list and read job status;
- retry, cancel, and disconnect.

The Angular panel supports connection, sync/backfill, progress, retry, cancel, disconnect, latest-job recovery after reload, bounded polling, and manual refresh after polling pauses.

The API/browser contracts exclude access tokens, refresh tokens, ciphertext, nonce/tag, key IDs, client secrets, raw provider payloads, dispatcher lease fields, account IDs, and foreign-account details.

## Validation evidence

The CI gate includes:

- fresh V109 migration and populated V105-to-V109 upgrade;
- migration-time role/privilege assertions;
- TypeScript project and Angular typechecking;
- credential round-trip, AAD isolation, key rotation, and malformed configuration tests;
- Strava OAuth/refresh, activity mapping, response-size, and rate-limit classification tests;
- API owner forwarding, UUID/range validation, and safe callback redirect tests;
- Angular recovery and bounded-polling tests;
- provider worker integration covering token refresh, multi-page empty termination, raw retention, exact workbook overlap, provider-only normalization, repeated-delivery convergence, dispatcher denial, and durable rate-limit rescheduling;
- existing import, rule-recomputation, database ownership, canonical export, importer, and production build regressions.

## Consequences

### Positive

- Provider credentials are decryptable for authorized background work without plaintext-at-rest storage.
- Queue discovery remains separated from credentials and canonical data.
- Raw provider snapshots and durable cursors make retries auditable and restart-safe.
- Provider identity remains stable across edits.
- Exact cross-source overlap avoids silent double counting while ambiguous collisions remain visible.
- Provider-specific HTTP behavior remains outside canonical scoring logic.

### Costs and limitations

- Deployments must provision, back up, rotate, and retain encryption keys safely.
- Raw provider retention increases database volume and requires a future retention policy.
- The first milestone has one Strava connection per account and manual sync initiation.
- Verified webhook ingress/processing, provider-side deletion/private reconciliation, scheduled reconciliation, and account-erasure policy are deferred.
- Conservative cross-source matching may require future explicit review tooling for ambiguous rows.

## Rejected alternatives

### Store provider tokens as plaintext

Rejected because a database read, backup leak, or overly broad role would expose live authorization material.

### Hash provider tokens like SportOS sessions

Rejected because background refresh and revocation require the original credential.

### Give the dispatcher credential access

Rejected because cross-owner queue discovery does not require credentials.

### Reuse upload-only import jobs

Rejected because provider work has no uploaded file and requires connection, mode, cursor, refresh, and rate-limit semantics.

### Persist only normalized activities

Rejected because it would remove replayable provenance and make mapping changes unauditable.

### Auto-merge by approximate date or distance

Rejected because false merges are harder to detect than explicit unresolved collisions.

### Let webhooks write canonical facts directly

Rejected because webhook delivery is partial, duplicated, and unordered. A future webhook receiver will enqueue durable reconciliation work instead.
