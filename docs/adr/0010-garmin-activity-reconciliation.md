# ADR 0010: Garmin auxiliary identity and conservative reconciliation

- Status: implemented; one live local extraction/retention/link proof passed, broader account/device evidence remains part of #99
- Date: 2026-10-07
- Issues: #97, #99; full archive ingestion #98 deferred by maintainer

Garmin activities enrich one account's existing compact Strava or explicitly
supported workbook/manual activities. Garmin never creates a canonical activity
in v1. Linking never updates canonical metrics, provenance, daily facts, scores,
ledgers or Run Lab events. The existing Strava ingestion policy in ADR 0006 still
controls Strava canonical writes; only reverse Garmin reconciliation is added.
Strava corrected distance remains authoritative for Strava-owned records;
workbook/manual source authority remains unchanged.

Garmin local authentication is separate from server Strava OAuth. The expanded
provider code recognizes Garmin, but no Garmin server OAuth connection, password,
credential envelope or automatic network fetch is introduced by this foundation.

## Identity and storage

One `(owner, native Garmin activity ID)` is shared across archive and Connect.
Decimal IDs normalize leading zeros; JavaScript numbers are rejected to avoid
loss of precision. Recoverable IDs take precedence. When absent, a SHA-256
`fingerprint:v1` of explicit normalized sport/subtype, UTC start, elapsed/moving
durations and distance stages the observation. Fallback identities **always
require explicit review**, even for a unique exact candidate; distinct content
versions with the same fingerprint are retained as potential collisions rather
than silently promoted. Missing timezone/start semantics are rejected, not guessed.
An upstream parser must resolve any fallback-to-native identity transition
explicitly; this foundation does not silently merge identities.

Primary V124 retains compact allowlisted matching metadata, source content
hashes, archive/Connect origin, source timestamps, stable identity, canonical link,
bounded evidence and append-only decision audit. It does not store original FIT,
full Garmin JSON, sets, telemetry, filenames, storage keys or paths in
`source_records` or canonical rows. Each distinct origin/hash version is retained;
identical deliveries converge. Conflicting normalized summaries under one content
hash are rejected. Newer source timestamps control current compact metadata;
equal timestamps use a deterministic hash tie-break. Older delivery retains its
version without regressing current metadata. Changed content never automatically
retargets a linked canonical UUID.

Dedicated detail migration V002 retains versioned Garmin resource chunks by the
same owner/identity/source hash **without requiring a canonical UUID**. This keeps
pending Garmin-only data safe until later Strava arrival. `detail`, `sets`, `laps`,
`records` and private `fit_manifest` resources are supported by the storage
contract. These are retained source data, not promoted metrics. Per-resource
application JSON is bounded to 4 MB, with a 5 MiB database bound and explicit chunk
indices; the reader loads one chunk at a time. Coverage returns at most 101
metadata rows (100 declared resources plus the private original manifest). Original FIT/ZIP bytes belong in replaceable blob storage, with
private references/checksums in a manifest. Targeted FIT parsing and blob/resource retention are implemented by #99; full
archive streaming and broader volume/device evidence remain follow-up #98/#99
work. No private export sample was needed or committed for #97.

The importer/extractor must retain original resources before submitting the
compact snapshot. Primary and detail databases have no distributed transaction:
retain immutable detail/blob content first, then reconcile compact metadata.
Retrying either phase converges. An abandoned retained resource is safe and does
not create a canonical fact. The compact metadata API is a foundation contract,
not a Garmin downloader or proof that original device telemetry is available.

## Match policy v1

Match against existing compact canonical rows only; no lazy Strava resource
request, summary refresh, Garmin network call or source-local date equality is
required. UTC instants handle DST and midnight independently of local dates.

| Evidence | Auto-link threshold |
|---|---|
| Sport | Same supported canonical type |
| Subtype | Indoor/treadmill cannot match outdoor/race/track |
| UTC start | At most 15 seconds apart; candidate window is ±120 seconds |
| Elapsed duration | Present on both; difference ≤ max(5 seconds, 1% of larger value) |
| Moving duration | If present on both, same tolerance; never compare elapsed to moving |
| Distance | If present on both, difference ≤ max(200 metres, 5% of larger value) |
| Missing distance/no GPS | Explicit subtype plus compatible elapsed **and** moving durations required |
| Workout/gym | Only exact start, explicit identical subtype and exact available metrics |
| Uniqueness | Exactly one plausible candidate, including nearby weak/conflicting observations |

These conservative thresholds are fixed and covered by synthetic fixtures. They
remain provisional despite one successful live-account match; broader device
evidence belongs to #99, and
the acceptance tests document the precise boundaries. Location/route/lap
corroboration is not used because compact summaries do not reliably supply it.
No field is fabricated to increase confidence. A strong match requires positive
comparable distance or the explicit no-GPS duration corroboration above. Exact
matches require elapsed duration and explicit subtype; nulls do not themselves
supply evidence.

Results are `exact`, `strong_unique`, `ambiguous`, or `unmatched`. A unique weak
candidate still means review. More than 100 candidates means ambiguity. Already
claimed canonical IDs also mean review; one canonical activity has at most one
Garmin identity. Malformed legacy metrics remain weak collisions rather than
being dropped and falsely conferring uniqueness on another candidate.

Garmin ingestion and Strava ingestion acquire the same account-keyed transaction
advisory lock. Later Strava ingest reconciles up to 100 pending identities within
±120 seconds, rechecking the complete canonical candidate window for each.
Overflow remains pending and is reviewable through bounded pagination/reopen.
Reject decisions survive ingestion retries and later Strava delivery. Linked
identities stay stable through later changes; explicit rejection is required
before reassignment.

## Review, reads and authorization

Authenticated API routes (unsafe methods require the existing session-bound CSRF):

- `POST /garmin/activities`: validated compact snapshot ingress, no owner argument.
- `GET /garmin/activities?limit=50&offset=0`: bounded staging/review list.
- `GET /garmin/activities/:id`: one staging identity with compact summary/evidence.
- `GET /garmin/activities/:id/audit`: at most 100 recent audit entries.
- `POST /garmin/activities/:id/review`: `{decision, activityId}`; `link` requires a
  canonical UUID, `reject` and `reopen` require null. `link` is also the explicit
  accept/manual-link path for an ambiguous candidate.

Only authenticated account context owns access; foreign/nonexistent IDs return
the same generic 404. Explicit same-account link/reject/reopen decisions are
append-only audited with previous state and the policy version. No user-authored
reason/narrative or raw payload is persisted in the audit. Primary API/worker-data
roles can read/write owner-scoped staging; the dispatcher and legacy/shared role
cannot read it. Version/audit tables are append-only with privilege and trigger
checks. Active canonical links must be explicitly rejected before deleting a
linked activity. Audit activity UUIDs are historical references: an insert
trigger enforces same-owner membership while the target exists, and historical
evidence remains after a later explicit unlink/deletion without blocking manual
replacement workflows. Dedicated detail access remains API-only and owner-scoped, immutable by
version; resources cannot be moved to another owner. No third database is added.

Canonical list/detail responses add a bounded `garmin` link descriptor.
Canonical reads remain available with a null descriptor when the optional
enrichment schema has not yet been migrated; Garmin writes still require V124. Lists
still count one canonical row; pending entries appear only in the reconciliation
API. #101 delivers detail-page source coverage and explicit Fetch/View/Refresh
controls; list-wide indicators remain follow-up. No page-view network fetch occurs. Exports/analysis continue selecting their existing canonical
allowlists and cannot read these auxiliary payloads.

## Validation

Focused matching/API tests cover corrected distance, null/no-GPS metrics,
timezone/DST, gym collisions, type/subtype conflicts, input bounds and authenticated
owner forwarding. Non-owner Postgres integration covers duplicate/concurrent
archive/Connect delivery, source versioning and out-of-order updates, unlinked
staging/later Strava arrival, review audit, unchanged canonical values, cross-owner
links, immutable owner/history, dispatcher denial and worker-data scope. Dedicated
detail tests cover unlinked retention, version conflicts, duplicate reuse, bounds
and foreign-owner denial. Existing provider-worker and activity-detail regressions
remain required. One live user-initiated login, strict targeted FIT extraction, resource retention,
cache reuse and unique Strava link passed. Broader MFA/expiry/rate-limit/device
coverage and full archive performance remain separate acceptance work.
