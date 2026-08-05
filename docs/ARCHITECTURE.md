# Architecture

## Goal

Replace spreadsheet formulas with a canonical, auditable sports-data system while preserving source provenance, deterministic score explanations, account ownership, conservative external-provider ingestion, and cited read-only generated analysis.

```text
OIDC provider -> opaque API session + CSRF
                         |
                         v
       account-bound pooled connection -> forced RLS + same-owner constraints
                         |
        +----------------+-------------------+
        |                                    |
        v                                    v
browser XLSX -> upload storage       Strava OAuth -> encrypted credential envelope
        |                                    |
        v                                    v
   import_jobs                       provider_sync_jobs
        |                                    |
        +---------- narrow queue dispatcher--+
                         |
                    persisted owner
                         |
                         v
              owner-scoped worker-data executor
                         |
                         v
              import_batches + source_records
                         |
          +--------------+----------------+
          |                               |
          v                               v
 activities + provider_activity_links   performance_events
          |                               |
          +---------------+---------------+
                          v
        daily_metrics + scoring_rules + score_ledger
                          |
                          v
       owner-scoped read repositories + deterministic analysis tools
                          |                         |
                          |                         v
                          |            validated generator + safe fallback
                          |                         |
                          |                         v
                          |                 analysis_runs audit
                          |                         |
                          +------------+------------+
                                       |
                                       v
                   canonical export + Angular cockpit
```

## System boundary

SportOS is an authenticated account-scoped monorepo. Postgres is authoritative for accounts, external identities, sessions, ownership, provider connection metadata, encrypted credential envelopes, OAuth state, sync cursors, job leases, audit history, provenance, canonical facts, rule versions, official scores, and append-only analysis-run metadata. Workbook bytes remain outside Postgres behind a replaceable storage contract. Generated guidance is not authoritative state.

The API authenticates an opaque server-side session, validates CSRF for unsafe methods, reserves one pooled connection, establishes the authenticated account on that connection, runs repository-owned transactions, and clears the context before release. Angular renders API truth and explicitly separates generated guidance from official records.

Background processing uses two database identities. A narrow dispatcher may discover and lease import, provider-sync, and rule-change jobs across accounts but cannot read provider connections or credentials, source rows, canonical facts, scoring rules, ledgers, performance data, analysis audit rows, or authentication data. A separate worker-data identity establishes the persisted owner before decrypting provider credentials or executing account data work.

Read-only analysis is an API-only composition boundary. Fixed account-scoped tools return sanitized facts, deterministic calculations, citations, and data-quality flags. An optional generator may summarize those results but cannot invoke repositories, issue SQL, select an owner, or write official data. The only analysis write is an append-only audit insert through a repository whose database grant is limited to `SELECT, INSERT` on `analysis_runs`.

## Architectural invariants

1. External `(issuer, subject)` maps to one immutable internal account UUID; mutable profile attributes are not ownership identity.
2. Every user-visible record has an explicit owner or documented shared-system exception.
3. Runtime identities are non-superuser and separate from the Flyway/schema owner.
4. API and worker-data access is account scoped by forced PostgreSQL RLS.
5. Account context is set on one reserved pooled connection and reset before release.
6. Valid foreign identifiers are indistinguishable from nonexistent identifiers at the API boundary.
7. Same-owner composite foreign keys prevent cross-account provenance, provider, canonical, rule, and job links.
8. Owner columns are immutable after insertion.
9. Queue dispatch is separated from owner-scoped data execution.
10. Raw input is retained before normalization with source, batch, record key, hash, owner, and source-specific metadata.
11. Uploaded bytes stay outside Postgres; storage keys, roots, and paths are private.
12. Provider authorization material remains server-side inside authenticated encrypted envelopes; the browser and dispatcher never receive it.
13. Provider credential encryption uses AES-256-GCM with versioned key IDs and owner/connection/provider/version additional authenticated data.
14. Provider-native identifiers are primary identities within a connection; workbook/provider overlap is resolved only by a documented deterministic policy.
15. Unsupported or ambiguous provider records are retained with warnings rather than guessed or discarded.
16. Official scoring is deterministic domain output and does not depend on Angular, providers, or generated text.
17. Every score contribution identifies the exact rule UUID, inputs, reason, and calculation payload.
18. Rule UUIDs are immutable semantic versions; enabled effective ranges are account scoped and cannot overlap.
19. Preview is read-only; rule publication and affected score replacement are atomic.
20. Re-imports and repeated provider delivery converge within an owner without duplicate canonical facts.
21. Postgres is authoritative for job state and leases; only the current lease owner may progress or complete work.
22. Sessions are opaque, digest-backed, bounded by idle/absolute expiry, revocable, and protected by session-bound CSRF.
23. Public dates are real `YYYY-MM-DD` calendar values normalized at repository boundaries.
24. Canonical exports are owner scoped, versioned, range bounded, deterministic, count checked, and assembled from one repeatable-read snapshot.
25. Raw cells, formulas, raw provider payloads, upload hashes, storage internals, account IDs, authentication data, credential envelopes, source bytes, prompts, and generated analysis are excluded from canonical export.
26. Analysis accepts only a fixed tool allowlist with exact, bounded inputs; models and browsers cannot provide owner identifiers, SQL, repository names, or arbitrary filters.
27. Totals, trends, comparisons, and official score explanations used by analysis are deterministic application output.
28. Generated observations may cite only evidence keys returned by the executed tool; invalid output falls back safely.
29. Imported/user-authored narrative and private source metadata are excluded from the generation boundary and never treated as instructions.
30. Analysis audit rows are owner scoped, append-only for the API role, and omit raw questions, generated answers, and canonical fact payloads.
31. Generated guidance, uncertainty, suggestions, and official records remain visibly and structurally distinct.

## Identity, sessions, and authorization

Authentication control-plane tables:

- `accounts`
- `external_identities`
- `auth_sessions`
- `auth_transactions`

SportOS uses OIDC Authorization Code with PKCE and does not store passwords. The provider's immutable issuer/subject pair provisions an internal account. Only opaque session and CSRF digests are stored. Sign-out revokes the server-side session.

The migrated single-user data belongs to fixed legacy account `00000000-0000-4000-8000-000000000001`. One explicitly configured OIDC issuer/subject may claim that account atomically; a second identity cannot claim it.

Runtime database identities:

- `sportos_app` — authentication control plane, provider authorization callbacks, account-scoped API data, and append-only analysis audit inserts;
- `sportos_legacy` — fixed legacy-account local CLI and compatibility tests;
- `sportos_worker` — narrow cross-owner queue dispatcher;
- `sportos_worker_data` — account-scoped import, provider-sync, and recomputation execution;
- `sportos_data` — shared no-login privileges, excluding authentication, provider credential, and analysis-audit control planes.

Credentialed CORS accepts one configured web origin. Unsafe authenticated requests, including analysis `POST` routes, require the readable CSRF cookie to be echoed in `X-SportOS-CSRF` and matched to the active session digest.

See [ADR 0005](adr/0005-authentication-and-data-ownership.md), [ADR 0007](adr/0007-read-only-ai-analysis.md), [AUTHENTICATION.md](AUTHENTICATION.md), and [AI_ANALYSIS.md](AI_ANALYSIS.md).

## Ownership, provider, and analysis migrations

- V105.1 creates upgrade-safe runtime-role placeholders.
- V106 creates identity/session tables, creates and backfills the legacy account, adds non-null owners, converts global identities to account scope, replaces links with same-owner foreign keys, enables forced RLS, and recreates owner-aware views.
- V107 removes owner/private identity fields from the public performance view.
- V108 separates dispatcher and worker-data authorization, restricts authentication-table grants, removes broad future grants, and makes ownership immutable.
- V109 creates provider connections, encrypted credential envelopes, OAuth transactions, sync jobs, activity links, and a bounded webhook inbox; it applies forced RLS, direct least-privilege grants, and migration-time privilege assertions.
- V110 creates append-only owner-scoped `analysis_runs`, grants only `SELECT, INSERT` to `sportos_app`, denies worker/legacy access, and asserts those privileges during migration.

Existing upload, batch, source-record, canonical, performance-event, rule, audit, daily, and ledger UUIDs are preserved during ownership backfill. Provider ingestion adds links rather than rewriting pre-existing workbook provenance. Analysis adds audit metadata only and does not rewrite canonical or scoring rows.

## Data and job layers

### Upload storage and metadata

`uploaded_files` stores account-owned metadata only. The `UploadStorage` contract lives in `packages/importers`; local objects use opaque keys and mode-`0600` writes. Public contracts omit object keys, roots, paths, bytes, hashes, and owner internals.

### Import jobs

`import_jobs` persists owner/upload/batch links, phase, progress, attempts, lease state, cancellation, result, and sanitized errors.

The dispatcher claims a job with `FOR UPDATE SKIP LOCKED` and returns the persisted owner. The worker-data executor establishes that owner before reading/writing account data. The transactional importer uses one account-bound connection; progress/cancellation callbacks use separate short owner-scoped connections so they do not deadlock the importer transaction.

### Provider connections and credentials

`provider_connections` exposes user-safe connection status, granted scopes, expiry, cursor, last sync, and sanitized errors. `provider_credentials` contains only the encrypted envelope: key ID, algorithm, nonce, ciphertext, authentication tag, and envelope version.

The API and worker share the same external key ring through deployment secrets. The active key encrypts new or refreshed tokens; retained older keys decrypt existing envelopes during rotation. Envelope additional authenticated data binds ciphertext to the immutable owner, connection, provider, and version, preventing ciphertext transplantation.

`provider_oauth_transactions` stores one-time hashed state with owner, provider, safe return path, and expiry. Callback completion requires the initiating authenticated account and required Strava scope.

### Provider sync jobs

`provider_sync_jobs` is a durable queue separate from upload-only jobs. It persists owner, connection, mode, requested range, cursor, page/count state, attempts, leases, cancellation, sanitized errors, result, and linked import batch.

The dispatcher sees only queue lifecycle columns. The worker-data executor establishes the claimed owner, decrypts credentials, serializes refresh rotation through the database connection row, fetches bounded activity pages, and stops on an empty page. Rate-limit responses move the job back to queued with a durable retry time and do not consume the retry budget.

A six-hour overlap around the connection high-watermark permits delayed or updated activities to converge. Page, counts, and high-watermark are persisted after each committed page so stale recovery or retry resumes safely.

### Raw provider provenance and cross-source identity

Every fetched provider activity is inserted into `source_records` under a `strava` import batch before canonical mutation. Unknown activity types remain warning-bearing raw records. Raw payload size is bounded and optional map/polyline fields are removed before a final truncation fallback.

`provider_activity_links` records provider activity ID, canonical activity ID, latest raw source record, deterministic fingerprint/version, availability, and provider update time.

Identity policy for a previously unseen provider activity:

1. one exact candidate matching canonical type, start instant, distance, and moving time is linked;
2. no candidate creates a new Strava canonical activity;
3. multiple candidates produce `POTENTIAL_DUPLICATE` and no canonical write.

When linking an existing workbook/manual fact, its source fields, values, and provenance are unchanged. Later provider updates mutate only Strava-owned canonical activities. Provider-linked running performance is written only for provider-owned canonical activities, avoiding duplicate performance facts for a workbook overlap.

### Rule versions and recomputation

A rule family is `(owner_id, code)` and a version is `(owner_id, code, version)`. A GiST exclusion constraint prevents overlapping enabled inclusive ranges within an account.

Activation records the authenticated account as actor. The dispatcher claims the audit job; the worker-data executor establishes the owner and atomically closes the superseded range, enables the proposed UUID, recomputes affected totals, replaces ledger rows, and completes the audit.

### Read models, analysis, and export

Invoker-security views operate over RLS-filtered tables and partition window functions by owner before omitting owner fields from public shapes.

Repositories provide narrow boundaries for daily score explanations, bounded cockpit summaries, performance/provenance reads, rule workflows, import/provider diagnostics, and strict canonical export. Provider credentials and raw payloads are never part of public read models or canonical export.

The analysis tool service reuses the daily read service under the authenticated account. It emits fixed-shape facts, deterministic statistics, exact source/rule/activity identifiers, and data-quality flags. It excludes filenames, notes, sheet names, hashes, rule codes/names/descriptions, and rule-name-derived ledger reason text before any external generation.

The generator boundary is provider-neutral. The deterministic fallback is the default. An explicitly configured HTTPS JSON endpoint may receive the bounded question plus sanitized official record and citation allowlist. Its output is accepted only when it matches the exact three-section schema and every observation cites returned evidence. Otherwise the fallback is used.

`analysis_runs` stores a question digest, bounded tool input summary, citation keys, generator metadata, outcome, and data-quality status. The raw question, generated text, facts, prompts, tokens, and user profile are not retained.

## Runtime flows

### Strava connect

1. Authenticated browser asks the API to connect Strava with a safe local return path.
2. API creates random state, stores only its digest with owner/expiry, and returns the Strava authorization URL.
3. Strava callback is handled under the current session; state is atomically consumed and required scope is checked.
4. API exchanges the one-time code server-side.
5. Tokens are encrypted with owner/connection-bound AES-GCM and stored with user-safe connection metadata.
6. Angular redirects back to the provider panel and never receives tokens or envelope fields.

### Provider worker

1. Authenticated API enqueues initial backfill, incremental, or webhook-refresh work.
2. Dispatcher claims globally and returns only job/owner/connection/range/cursor metadata.
3. Worker-data executor establishes the persisted owner.
4. Near-expiry credentials are refreshed and atomically rotated.
5. Worker fetches pages, writes raw rows, conservatively normalizes, commits counts/cursor, and continues until an empty page.
6. Rate limits durably reschedule; cancellation and stale leases preserve committed progress.
7. Terminal job/connection/batch state remains under the same owner.

### Disconnect

1. API loads/decrypts authorization under the authenticated owner and attempts remote revocation.
2. Remote failure does not prevent local safety cleanup.
3. Credential envelope is deleted.
4. Queued jobs are cancelled; running jobs receive cooperative cancellation.
5. Connection metadata/provenance remains for audit while future synchronization is disabled.

### Read-only analysis

1. Authenticated Angular submits a bounded question plus one fixed tool request; no owner identifier is accepted.
2. The API validates exact fields, real dates, ordered ranges, limits, and question length.
3. Requests to mutate authoritative data are refused before tool or generator execution.
4. The tool service enters the authenticated account context and retrieves only the fixed read model.
5. Deterministic application code computes totals/comparisons and emits sanitized facts, citations, and quality flags.
6. Missing data uses deterministic insufficient-data guidance. Otherwise the configured generator runs; invalid or unavailable external output falls back deterministically.
7. The API inserts an owner-scoped audit row containing only digest/metadata/source identifiers.
8. Angular renders generated guidance separately from official evidence, quality flags, citations, and audit reference.

## Package responsibilities

| Package or app | Responsibility |
|---|---|
| `apps/api` | OIDC/session/CSRF, provider OAuth, account context, HTTP validation, orchestration, reads, analysis tools/generation validation, audit inserts, export delivery |
| `apps/web` | authenticated accessible cockpit, provider workflows, and separated generated/official analysis UI; no authoritative calculations or credential handling |
| `apps/worker` | split queue dispatch and owner-scoped import/provider/rule execution; legacy CLI |
| `packages/shared` | serialization schemas, real-date utilities, canonical export contract |
| `packages/domain` | pure aggregation, scoring, reconciliation, rule validation, preview logic |
| `packages/db` | identity/session/provider/analysis-audit persistence, account context, typed schema, RLS-compatible repositories, dispatcher, leases, audits, reads, export assembly |
| `packages/importers` | storage, XLSX extraction, provider adapter/cipher contracts, normalization, warnings, import transactions |
| `packages/analytics` | pure analytics without database dependencies |
| `flyway/sql` | append-only migrations, grants, ownership constraints, RLS, views, indexes, privilege assertions |

## Current risks

- Workbook assumptions are based on a small known sample.
- Local source storage is single-host and needs coordinated database/object backup.
- Production OIDC/Strava registration, runtime-role provisioning, key management, monitoring, backup/restoration, and account deletion require deployment operations beyond source code.
- The dispatcher is trusted for queue lifecycle only; its credentials require strict isolation.
- Postgres polling adds periodic load; wake-up acceleration must preserve durable claims.
- Strava fixtures exercise documented contracts but cannot replace production sandbox/limited-athlete operational testing.
- Provider webhook subscription verification and inbox processing are not yet operational.
- Provider-local dates are retained conservatively; a broader cross-provider time-zone/locale decision remains future work.
- Rule recomputation, canonical export, and the initial analysis tool ranges remain intentionally bounded.
- Citation validation proves that generated observations reference returned evidence; it does not prove perfect semantic entailment for every external-model sentence.
- Operators enabling external generation are responsible for endpoint retention, regional processing, access control, vendor terms, and monitoring.
- Append-only analysis audit metadata must be incorporated into any future audited account-deletion workflow.

Milestone sequencing is tracked in [ROADMAP.md](ROADMAP.md).