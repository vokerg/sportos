# Roadmap

SportOS is sequenced by product risk: trustworthy facts and deterministic scores first, convenient workflows second, accounts/providers third, and read-only generated analysis only after stable authorized read models exist.

## Status vocabulary

- **Implemented**: source code exists.
- **Validated**: representative automated or repeatable evidence exists.
- **Operational**: observable failure handling supports repeated use without repository intervention.

A feature is not delivered solely because a component or table exists.

## Current baseline

| Area | Current state | Main remaining gap |
|---|---|---|
| Repository and fresh schema | Defined through V128; dedicated activity-detail V003 | routine maintenance and hosted backup/recovery |
| Raw provenance and imports | Validated and account scoped | hosted object lifecycle and deletion |
| Browser upload/storage | Validated and account scoped for XLSX and manual Garmin CSV staging | hosted storage backup and erasure |
| Durable jobs | Import, provider-sync, and rule-change lifecycles validated | wake-up acceleration and hosted observability |
| Deterministic scoring | Validated and account scoped; imported workbook ledgers remain authoritative, while calculated run achievements use the universal highest-tier pace ladder per completed 5 km | additional semantics only when evidence justifies them |
| Rules Studio | Validated with authenticated actor identity | hosted-scale recomputation |
| Score reconciliation | Validated on sanitized evidence | permitted historical evidence for unresolved workbook semantics |
| Cockpit review and export | Validated and account scoped | larger export delivery |
| Authentication and ownership | Validated with non-superuser RLS evidence | production OIDC/secret operations and account deletion policy |
| Provider ingestion | Strava connection, refresh, backfill, incremental sync, retry, disconnect, and provenance validated | webhook processing and additional providers |
| API | Authenticated, CSRF-protected, account scoped, and equipped with narrow cited analysis tools | hosted monitoring and external rate limiting |
| Web UI | Authenticated routed workspace with upper navigation, dense Daily Log, Monthly Stats, daily rolling-window Dynamics, selected-day highlights, exhaustive day edit/raw-provenance view, and dedicated import, provider, rule, run, analysis, and export pages | broader provider portfolio and additional analysis tools |
| Hosted operation | Partially implemented | deployment, key management, backup, restoration, deletion, and observability |
| Read-only analysis | Validated with cited evidence, deterministic calculations, safe fallback, append-only audit metadata, evaluations, and UI separation | hosted model-gateway operations and broader semantic evaluation |

## Milestone 0: trustworthy local ingestion

Delivered:

- reproducible install, fresh migrations, tests, and builds;
- sanitized XLSX fixtures;
- source-row provenance and canonical links;
- transactional/idempotent imports and rollback;
- score breakdown and reconciliation;
- import history and row diagnostics;
- explicit scoring units, rounding, thresholds, priorities, effective dates, and base/bonus semantics;
- imported workbook `All` authority with visible imported/calculated/manual row status, append-only score snapshots, explicit Strava-backed recalculation, focused manual entry, and Excel-like bulk quick entry over the same canonical save path;
- machine-readable exact/explained/unresolved evidence.
- manual Garmin CSV upload with raw provenance, exact-file deduplication, overlap-safe staging, and no scoring side effects.

The detailed evidence is maintained in [FIRST_MILESTONE.md](FIRST_MILESTONE.md).

## Milestone 1: usable local cockpit

Delivered:

1. bounded browser upload and durable external source-file storage;
2. durable asynchronous import jobs and independent worker execution;
3. immutable rule versions, read-only previews, audited jobs, and atomic recomputation;
4. Daily Log and Run Lab drill-downs plus strict canonical export;
5. a lazy-routed authenticated workspace that keeps the high-density daily table while separating selected-day highlights from the exhaustive editable day/provenance view.

Milestone 1 was completed through issue #13.

## Milestone 2: accounts and integrations

Delivered account foundation:

- OIDC Authorization Code + PKCE without SportOS password storage;
- immutable internal account UUIDs and external `(issuer, subject)` identities;
- opaque server-side sessions with idle/absolute expiry and revocation;
- HttpOnly cookies, session-bound CSRF validation, and exact-origin credentialed CORS;
- explicit legacy-account backfill preserving all existing provenance/canonical UUIDs;
- non-null owner keys, account-scoped business constraints, and same-owner foreign keys;
- forced PostgreSQL row-level security exercised through non-superuser API/legacy roles;
- global worker claim with persisted owner propagation;
- authenticated Angular bootstrap, expiry handling, and safe sign-out;
- cross-user negative database and API evidence.

Delivered provider foundation:

- provider-neutral authorization, activity-page, refresh, revoke, error, and rate-limit contracts;
- application-encrypted credential envelopes with versioned AES-256-GCM keys and authenticated owner/connection context;
- durable owner-scoped provider connections, OAuth state, cursors, sync jobs, activity links, and bounded webhook inbox schema;
- separate dispatcher and owner-scoped worker-data authorization, with migration-time privilege assertions;
- Strava OAuth connection, rotating refresh tokens, initial backfill, incremental overlap sync, retries, rate-limit rescheduling, cancellation, and disconnect;
- raw provider activity retention before conservative normalization;
- deterministic provider identity plus explicit one-match/no-match/ambiguous workbook overlap behavior;
- browser connection, status, retry, cancellation, disconnect, provenance, and bounded polling states;
- fake-provider integration evidence for refresh, pagination, empty-page termination, retry convergence, and dispatcher denial.

See [ADR 0005](adr/0005-authentication-and-data-ownership.md), [ADR 0006](adr/0006-provider-ingestion-and-strava.md), and [AUTHENTICATION.md](AUTHENTICATION.md).

Remaining operational work:

1. production OIDC and Strava registration/secret provisioning;
2. webhook subscription verification and inbox processing;
3. additional providers and provider-specific fixtures;
4. time-zone/locale policy beyond conservative source-local dates;
5. hosted monitoring, backup/restoration, key-management-service integration, and audited account deletion.

Milestone 2 exit is satisfied for the first provider: a user can connect Strava, backfill or incrementally sync, and trace ownership/raw provenance for every normalized provider fact.

## Milestone 3: read-only analysis

Delivered:

- a fixed read-only tool allowlist over stable account-authorized daily and score-breakdown reads;
- strict dates, ranges, limits, question length, and exact request fields before repository execution;
- canonical date, activity, immutable rule UUID, score-ledger, source-record, and import-batch citations;
- deterministic totals, averages, extrema, first-to-last comparison, and official score calculations outside the generator;
- generated `observations`, `uncertainty`, and `suggestions` with observations restricted to returned citation keys;
- deterministic local fallback and an optional bounded operator-controlled HTTPS JSON generator;
- refusal of authoritative write requests and explicit medical/insufficient-data limitations;
- prompt-injection reduction by excluding imported narrative, filenames, hashes, rule names/descriptions, and rule-name-derived ledger reason text;
- append-only owner-scoped audit metadata without raw questions or generated answers;
- cross-account isolation evidence and evaluations for missing, conflicting, ambiguous, malicious, unsupported-write, and medical cases;
- an Angular entry point that visibly separates generated guidance from official SportOS evidence.

See [ADR 0007](adr/0007-read-only-ai-analysis.md) and [AI_ANALYSIS.md](AI_ANALYSIS.md).

Milestone 3 exit is satisfied: generated analysis can explain canonical data without authoritative calculation or write access.

## Near-term queue

Issue #3 remains authoritative. The foundational queue is complete through issue #16; routed frontend maintenance and explicitly prioritized product work continue in the active P3 queue. New work must be added and prioritized there rather than inferred.

Each PR must identify the milestone or operational exit criterion it advances and include repeatable evidence appropriate to the risk.

## Accepted decisions

- [ADR 0001](adr/0001-import-transactions-and-identity.md) — import transactions and identity.
- [ADR 0002](adr/0002-upload-storage-and-retention.md) — source-file storage and retention.
- [ADR 0003](adr/0003-import-job-lifecycle.md) — durable import job lifecycle.
- [ADR 0004](adr/0004-rule-versioning-and-recomputation.md) — immutable rule versions, preview, audit, and atomic recomputation.
- [ADR 0005](adr/0005-authentication-and-data-ownership.md) — identity, sessions, database ownership, and worker context.
- [ADR 0006](adr/0006-provider-ingestion-and-strava.md) — provider adapters, encrypted credentials, durable synchronization, provenance, and cross-source identity.
- [ADR 0007](adr/0007-read-only-ai-analysis.md) — read tools, deterministic calculations, generated-answer validation, audit, and UI separation.
- [ADR 0009](adr/0009-manual-garmin-csv-staging.md) — manual Garmin CSV upload, raw retention, overlap-safe staging identity, and canonical isolation.
- [ADR 0010](adr/0010-garmin-activity-reconciliation.md) — compact Garmin identity, immutable auxiliary retention and conservative canonical linking.
- [Canonical export v1](CANONICAL_EXPORT.md) — versioned canonical datasets, stable ordering, reconciliation, provenance states, and privacy exclusions.

See [ADR 0008](adr/0008-imported-ledger-authority-and-explicit-recalculation.md) for imported ledger authority, append-only score history, and explicit activity-based recalculation.

Future decisions still required include provider webhook operations, time-zone/locale policy, hosted observability, backup/restoration, key lifecycle, deletion, hosted model-gateway operations, broader semantic evaluation, and any expansion of the analysis tool surface.

## Garmin activity enrichment delivery status

Maintainer reprioritization activates #97 and the targeted #99/#101 phases before
full archive #98. Delivered functionality includes conservative identity/linking
and reverse reconciliation, the isolated local FIT/Connect extractor, authenticated
auxiliary retention and explicit activity-page Fetch/View/Refresh for both sources.
Opening an activity never downloads rich provider data. Live local extraction,
retention, cache reuse and unique Strava linking passed with unchanged canonical
facts and official scores. Primary V124 and dedicated detail V002 are applied in
the maintained local environment; fresh environments require both migration sets.

#99 remains open for manual incremental discovery/jobs/checkpoints and broader
MFA/expiry/rate-limit/device evidence. #101 remains open for list-wide coverage
indicators and its remaining acceptance work. #98 full archive is still deferred;
#100 broader retained-detail read models and #102 optional compact-Strava preflight
are not implicitly completed by this delivery. No hosted Garmin token integration,
Garmin-only canonical promotion, scoring change or Run Lab consolidation is added.
Browser visual verification remains outstanding after local browser permission
was declined; component/API/integration and root checks passed.

See [Activities](ACTIVITIES.md), [local Garmin operation](GARMIN_SINGLE_ACTIVITY.md)
and [ADR 0010](adr/0010-garmin-activity-reconciliation.md).

## Explicit Garmin day evidence (#106)

The maintainer-prioritized day workflow adds explicit Fetch/View/Refresh, immutable
auxiliary payloads before compact Connect projections, independent partial retries,
multiple body measurements and existing activity reconciliation. Primary V125 and
detail V003 are required. Focused/offline/non-owner and selected live-day evidence
passed; official rows are unchanged. PR #107 is merged.
See [operation and limitations](GARMIN_DAY_FETCH.md). Garmin-aware recalculation,
archive and recurring synchronization remain separate work.

## Enriched explicit recalculation (#108)

Merged PR #109 extends explicit recalculation with retained Connect
steps and compact strength summaries. No Garmin network call occurs during
scoring. See SCORING_RULES.md and implementation/issue-108.md for policy and
validation; the queue item remains open until merge.

## Non-scoring walking history (#110)

Draft PR #111 retains Strava walks as Activities, supports conservative Garmin
linkage and provides explicit retained-source backfill without changing scoring.
See [walking operations](WALKING_ACTIVITIES.md) and implementation/issue-110.md.
