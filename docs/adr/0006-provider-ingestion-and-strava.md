# ADR 0006: Provider ingestion framework and Strava adapter

- Status: proposed
- Date: 2026-08-04
- Issue: #15

## Context

SportOS currently ingests bounded workbook uploads. The importer already provides durable owner-scoped jobs, raw-before-normalized provenance, canonical activity/performance writes, deterministic scoring, retries, cancellation, and split dispatcher/data-worker authorization.

A provider integration adds materially different concerns:

- a user grants and revokes provider authorization independently of SportOS sign-in;
- access and refresh credentials must remain decryptable for background work, but must never be stored as plaintext, returned to the browser, exposed to the queue dispatcher, or logged;
- backfills and incremental syncs need durable pagination/cursor state, rate-limit handling, retries, and restart recovery;
- provider records can be created, updated, deleted, or made private after initial ingestion;
- provider activities can overlap activities already imported from a workbook;
- raw provider payloads must be persisted before canonical normalization;
- provider-specific behavior must not leak into the canonical domain or make Strava the only possible integration.

Strava's current API constraints shape the first adapter:

- OAuth authorization codes are exchanged server-side with the application client secret;
- access tokens are short lived and refresh responses may rotate the refresh token immediately;
- activity-list endpoints are paginated and clients must continue until an empty page rather than treating a short page as terminal;
- response headers expose 15-minute and daily application/read usage, and `429` responses require bounded rescheduling;
- webhook events are the supported hint for activity changes and athlete deauthorization;
- Strava is moving the V3 API hostname, so the adapter base URL must be configurable rather than scattered through application code;
- the current token-revocation endpoint should be used for disconnect, while raw/canonical SportOS provenance remains retained.

Official references:

- <https://developers.strava.com/docs/authentication/>
- <https://developers.strava.com/docs/rate-limits/>
- <https://developers.strava.com/docs/webhooks/>
- <https://developers.strava.com/docs/reference/>
- <https://developers.strava.com/docs/changelog/>

## Decision

### Provider-neutral package boundary

Create `@sportos/providers` as a framework-neutral package. It may depend on Node platform APIs and shared value contracts, but not NestJS, Angular, Kysely repositories, or worker process entry points.

The core adapter contract exposes:

```ts
interface ProviderAdapter {
  readonly provider: ProviderCode;
  createAuthorizationUrl(input: AuthorizationRequest): URL;
  exchangeAuthorizationCode(input: AuthorizationCodeExchange): Promise<ProviderAuthorization>;
  refreshAuthorization(input: ProviderAuthorization): Promise<ProviderAuthorization>;
  revokeAuthorization(input: ProviderAuthorization): Promise<void>;
  fetchActivityPage(input: ActivityPageRequest): Promise<ActivityPage>;
  fetchActivity(input: ActivityRequest): Promise<ProviderActivity | null>;
}
```

Provider HTTP responses are converted into explicit transport results containing:

- sanitized provider error classification;
- raw JSON payloads;
- page/cursor information;
- rate-limit limits and usage;
- retry timing when known;
- granted scopes and authorization expiry;
- provider account identity.

The adapter does not write Postgres, create canonical facts, select owners, or manage job leases. API and worker orchestration own those responsibilities.

### Credential encryption and key rotation

Provider credentials are encrypted in the application before persistence using AES-256-GCM.

Deployment configuration supplies a key ring and one active key identifier. Each key is exactly 32 random bytes. The key ring is available only to the API provider callback/service and provider data worker; it is not stored in Postgres, returned to the browser, embedded in a bundle, or logged.

Persist a versioned envelope:

- `key_id`
- `algorithm` (`aes-256-gcm`)
- `nonce`
- `ciphertext`
- `authentication_tag`
- `created_at` / `rotated_at`

Authenticated additional data binds the envelope to:

- provider connection UUID;
- owner UUID;
- provider code;
- credential-envelope version.

A ciphertext copied to another connection or account therefore fails authentication.

`provider_credentials` is a separate one-to-one table from user-visible connection metadata. It is owner scoped and force-RLS protected, but is granted only to `sportos_app` and `sportos_worker_data`; it is excluded from `sportos_data`, `sportos_legacy`, and the dispatcher role.

Refresh is serialized with `SELECT ... FOR UPDATE` on the credential row. The worker decrypts the latest envelope, refreshes only when required, and atomically replaces both access and refresh credentials because Strava can invalidate the previous refresh token immediately. Failures never include token material.

A future key-rotation command can decrypt with the recorded key and re-encrypt with the active key without changing connection, provider, or canonical identifiers.

### Durable provider persistence

Add append-only migration V109 with the following account-owned tables.

#### `provider_connections`

Metadata safe for authenticated user-facing status:

- UUID and owner;
- provider code (`strava` initially);
- immutable provider account ID;
- sanitized display label;
- granted scopes;
- connection status (`connected`, `reauthorization_required`, `revoked`, `disconnected`, `error`);
- access-token expiry timestamp, without token material;
- durable successful incremental high-watermark/cursor JSON;
- last successful sync, last attempt, and sanitized error classification;
- created, updated, disconnected, and revoked timestamps.

One provider account can belong to only one SportOS account. The global `(provider, provider_account_id)` uniqueness constraint prevents accidental multi-account attachment, while API errors remain generic to avoid enumeration. One active connection per owner/provider is supported for the first milestone.

#### `provider_credentials`

One encrypted credential envelope per connection, same-owner constrained and immutable-owner protected. Deleting this row removes SportOS's ability to access the provider without deleting retained provenance or canonical history.

#### `provider_oauth_transactions`

One-time digest-backed provider authorization state tied to the authenticated owner, provider, safe return path, and expiry. It is API-control-plane data and is not granted to workers, legacy CLI, or shared runtime roles.

#### `provider_sync_jobs`

A durable queue separate from upload-only `import_jobs`:

- owner and connection;
- mode (`initial_backfill`, `incremental`, `webhook_refresh`);
- status, phase, progress, attempts, cancellation, lease, heartbeat, and sanitized terminal error fields;
- requested inclusive time bounds where applicable;
- durable job cursor JSON updated after each committed page;
- linked `import_batch_id` after the raw/canonical transaction commits;
- result JSON containing counts and warnings only, never credentials or raw payloads.

Postgres remains authoritative. The dispatcher may claim/recover provider jobs across owners but can read only queue lifecycle fields and the immutable owner/connection identifiers. It cannot read credentials, raw provider records, canonical data, or authentication tables. The provider worker opens a separate owner-scoped worker-data connection.

Only one queued/running sync job per connection is allowed. A failed job can be retried within its bounded attempt budget. A disconnected or revoked connection cannot enqueue or be claimed.

#### `provider_activity_links`

A same-owner mapping from `(connection_id, provider_activity_id)` to one canonical activity and the latest normalized source record. It stores provider update time and a deterministic identity fingerprint, but no credential or raw payload.

This mapping makes repeated pages, retries, incremental syncs, and provider updates converge on one canonical activity even though each sync may retain a new raw snapshot.

#### `provider_webhook_events`

A bounded deduplicated inbox for provider event hints:

- provider event identity/digest;
- provider account/activity identity;
- aspect (`create`, `update`, `delete`, `deauthorize`);
- raw event JSON;
- received and processed timestamps;
- sanitized processing error.

Webhook receipt does not normalize facts directly. It records the event, resolves the owner through the provider account mapping without exposing whether one exists, and enqueues a provider sync job. Duplicate delivery converges through the inbox digest and active-job constraint.

### Raw-before-normalized flow

A provider sync job creates an `import_batches` row with `source_kind = 'strava'`, `source = 'strava_api'`, and a same-owner provider connection/job link.

For every fetched activity:

1. validate size and required identity fields;
2. persist a `source_records` row containing the bounded raw JSON, provider activity ID, page/cursor metadata, and deterministic raw hash;
3. only after the raw row exists, map supported fields conservatively;
4. insert/update the canonical activity through `provider_activity_links`;
5. optionally create/update a performance event for supported run-distance records;
6. link every raw snapshot to the resulting canonical activity or mark it skipped/error with warnings;
7. commit the page and durable job cursor together.

Retries may retain the same raw snapshot in a new batch, but canonical facts converge through the provider activity link and existing owner/source identities. Raw payloads stay out of API summaries, logs, exports, and job result JSON.

### Conservative Strava mapping

The first adapter requests the minimum configured read scope needed for the selected connection mode. The callback verifies the actual granted scope and refuses to mark the connection usable when required scope is absent.

Canonical mapping rules:

- provider activity ID is retained as a string, never coerced through an unsafe JavaScript number;
- `start_date` is the canonical UTC instant;
- the provider-local calendar date is derived from validated provider local date/time metadata and retained with the raw timezone value;
- supported activity types map explicitly to SportOS activity types; unknown or unsupported types are skipped with a warning rather than guessed;
- distance, elapsed/moving duration, elevation, heart rate, speed, and manual/indoor/race indicators are mapped only when finite and semantically documented;
- privacy-sensitive map/polyline/location fields remain in bounded raw provenance and are not exposed in canonical API/export contracts;
- deleted or newly inaccessible provider activities mark the provider link unavailable and trigger a documented canonical retention/reconciliation policy rather than silently erasing audit history.

The API base URL is one adapter configuration value. The default follows the current official V3 hostname, while tests use a fake transport.

### Pagination, cursors, and rate limits

The Strava adapter requests at most 200 activities per page. It continues until an empty page because the provider documents that a non-final page can contain fewer rows than requested.

An initial backfill freezes an upper `before` bound and persists page/cursor progress after each committed page. An incremental sync starts from the last successful high-watermark with a small deterministic overlap window so boundary updates are re-read safely. Provider IDs and update timestamps make overlap delivery idempotent.

Every response records the rate-limit headers in the job's bounded operational metadata. The worker stops before exhausting a known limit and reschedules `next_attempt_at` at the next natural 15-minute boundary or the next UTC daily reset as appropriate. `429` is retryable without consuming unbounded attempts; malformed authorization, missing scopes, or revoked credentials transition the connection to `reauthorization_required` or `revoked`.

No busy-loop polling is allowed. Webhooks are event hints; scheduled incremental reconciliation remains the correctness backstop.

### Cross-source identity policy

Workbook and provider records are not silently merged by approximate distance or date alone.

For each provider activity, compute a versioned fingerprint from documented normalized facts such as activity type, exact UTC start when known, integer distance, and moving/elapsed duration.

Resolution order:

1. an existing `(connection, provider_activity_id)` link always wins and updates the same canonical activity;
2. an exact high-confidence fingerprint match to one canonical activity may attach the provider source to that activity;
3. no match creates a new canonical activity and provider link;
4. ambiguous or near matches are not normalized into a second scoring fact; the source record is retained with a `POTENTIAL_DUPLICATE` warning and surfaced for explicit resolution.

The fingerprint version and decision are recorded in provenance. Changing the policy requires a new version and migration/reconciliation path; historical decisions are not reinterpreted silently.

### Disconnect, revoke, and retention

Authenticated disconnect:

1. serializes against refresh/sync work;
2. attempts the provider's current revocation endpoint with server-side client authentication;
3. deletes the encrypted credential row regardless of a provider's idempotent not-found response;
4. marks the connection disconnected and cancels queued jobs;
5. prevents future claims and webhook-triggered syncs.

Provider deauthorization webhook marks the connection revoked, deletes credentials, and cancels queued jobs.

Disconnect/revoke does not delete import batches, raw source records, provider links, canonical facts, scores, or audit history. Account deletion remains a separate explicit audited lifecycle.

### API and browser boundary

Authenticated API routes will provide:

- start connection;
- callback completion;
- connection/status list;
- enqueue bounded backfill or incremental sync;
- job status/retry/cancel;
- disconnect;
- provider provenance and warnings.

Owner and provider account identifiers are never accepted as authority from browser input. Controllers derive the SportOS owner from the session. Valid foreign connection/job UUIDs return the same generic result as nonexistent UUIDs.

The browser receives only status, granted-scope names, safe provider display metadata, sync progress/counts, warnings, and provenance references. It never receives access tokens, refresh tokens, ciphertext, nonce/tag, key IDs, provider client secret, raw payloads, dispatcher fields, or foreign account details.

### Validation strategy

Use a fake provider transport and sanitized contract fixtures. Required evidence includes:

- authorization callback and scope validation;
- credential encryption/decryption, AAD mismatch rejection, malformed envelope rejection, and key rotation;
- serialized refresh-token rotation;
- initial backfill across multiple pages;
- continuation after a short non-empty page and termination only on empty page;
- durable cursor restart after worker interruption;
- incremental overlap without canonical duplicates;
- retry delivery and stale lease recovery;
- 429 and near-limit rescheduling;
- revoked/expired authorization behavior;
- webhook duplicate delivery and deauthorization;
- same-user access and denied cross-user connection/job/provenance access;
- dispatcher denial for credentials/raw/canonical data;
- raw-before-normalized rollback behavior;
- workbook overlap exact-match, no-match, and ambiguous-match fixtures;
- disconnect/reconnect with retained provenance;
- fresh migration, non-owner integration, importer/worker regressions, and root build.

A manual seed path may insert an encrypted test authorization only in explicit local development; plaintext credentials must never be committed or accepted by a production browser route.

## Consequences

### Positive

- Provider-specific HTTP/OAuth behavior remains isolated from canonical scoring and framework code.
- Credentials are recoverable for background work without being plaintext at rest.
- Queue dispatch remains separated from sensitive provider/canonical data.
- Raw payloads and pagination state survive retries and worker restarts.
- Repeated syncs converge through provider identity links.
- Cross-source overlap cannot silently double-count ambiguous activities.
- The same framework can support Garmin or another provider without copying ownership, encryption, queue, and provenance rules.

### Costs and risks

- Application-layer encryption requires operational key provisioning, rotation, backup, and disaster-recovery procedures.
- One worker process currently hosts multiple runners; provider code must still preserve database-role separation and avoid sharing decrypted credentials outside the provider runner.
- Webhook verification and provider application registration are deployment obligations.
- Provider API terms, hostnames, schemas, and limits can change and require monitored adapter updates.
- Conservative collision handling can require user review before a provider activity affects official scoring.
- Raw provider retention increases database/storage volume and needs bounded payload and retention policy work.

## Rejected alternatives

### Store provider tokens as plaintext in Postgres

Rejected because a database read, backup leak, or overly broad role would immediately expose live authorization material.

### Hash provider tokens like SportOS sessions

Rejected because background sync and revocation require the original provider credential.

### Give the dispatcher access to encrypted credentials

Rejected because queue discovery does not require credentials and the split-role boundary exists specifically to limit a cross-owner identity.

### Reuse upload-only `import_jobs`

Rejected because provider sync has no uploaded file and requires provider connection, mode, cursor, rate-limit, webhook, and refresh semantics. A separate queue can still reuse the same lease/state-machine pattern.

### Persist only normalized activities

Rejected because it would violate raw-before-normalized provenance, make mapping changes unauditable, and prevent reliable replay/debugging.

### Auto-merge workbook/provider activities by date and approximate distance

Rejected because unrelated activities can share those values and a false merge is harder to detect than a surfaced unresolved collision.

### Let webhooks write canonical facts directly

Rejected because webhook delivery is duplicated, unordered, partial, and does not contain a complete activity representation. Webhooks enqueue durable sync work instead.
