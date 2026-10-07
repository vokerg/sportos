# Issue 99 targeted first phase

Maintainer authorization: single-activity local Garmin lookup/download precedes
full archive #98. #97 is implemented in dependency draft PR #103. Branch was
created from current main and fast-forwarded to the dependency; this PR targets
the dependency branch and owns only #99 changes. Bulk incremental sync, historical
archive ingestion and #101 UI are deferred, not claimed complete.

Before implementation inspected: all #97 investigation files, GitHub #99/#98/#97
and #3, docs/garmin-daily-backfill.md, upstream python-garminconnect README,
releases, pyproject.toml, example.py, garminconnect/__init__.py, client.py and
activity implementation at pinned release 0.3.17. A real activity target was
provided privately and must not appear in committed fixtures/docs.

Invariants: local interactive authentication/MFA only, protected tokens outside
repo, no browser-cookie extraction or plaintext password retention; bounded
single-activity I/O; metadata/cache preflight before original download; raw detail
and original bytes retained outside primary; normalized metadata only enters the
shared resolver; no canonical Garmin-only rows or implicit scoring writes.

Additional inspected files: apps/api/src/auth/auth.controller.ts,
auth.service.ts, session.guard.ts; apps/api/src/main.ts and app.module.ts;
packages/importers/src/upload-storage.ts and index.ts;
apps/api/src/storage/local-upload-storage.ts; .gitignore, .env.example;
upstream fitdecode reader/types/profile and pinned SDK download/login/API code.

Implemented targeted first phase: protected user-initiated login/token reuse,
metadata-first cache preflight, one original FIT/ZIP download, strict bounded FIT
reader and raw/developer fields, detail/sets retention, authenticated multipart
resource/original API and complete-coverage commit through #97. Original bytes
and raw-before-normalized local evidence remain outside primary/Git.

Synthetic end-to-end check passed against isolated local non-owner primary/detail
Postgres and a local dev-single-user API: extraction, multipart resource/original
retention, unlinked staging, idempotent same-UUID replay, unchanged canonical row
count, and metadata-only second run. No Garmin network request was made by tests.
Parser/transport tests cover CRC/truncation, unsafe/multiple FIT ZIPs, unknown
fields/semantics, cache reuse/deleted resources, upstream failure, oversized
stream, redirects and 429. API tests cover rejected extra owner/path fields,
bounds, separate detail ownership and refusing premature commit.

Live browser access was denied; no browser credential extraction was attempted.
The user subsequently completed local terminal authentication. The selected real
activity downloaded and passed strict FIT parsing; repeat extraction reused the
cache. Running dynamics and power fields were retained. A read-only check against
the existing SportOS canonical data found one strong Strava match. No personal
identifiers, payloads, hashes or metrics are included in committed evidence.

Subsequent maintainer authorization allowed Chrome access to Neon and local
configuration of both existing schema-owner connections. No passwords were reset
and credentials remain only in the protected, ignored local environment file.
Flyway was installed and applied primary V124 and dedicated detail V002.
The deployed primary history had cache-move SQL recorded as V122; its exact
checksum matches current V123, while the track-subtype V122 was missing. The
original history entry was preserved privately, its version/script aligned to
V123 without changing the checksum, and Flyway applied missing V122 out of order.
The deployed subtype constraint and old-cache absence confirmed the preconditions.
The migration wrapper now handles pnpm’s optional argument separator.
Live authenticated retention then passed with a strong unique link to the
existing Strava activity; repeat import used the remote cache. An owner-scoped
before/after comparison confirmed unchanged canonical activity facts, daily
points and ledger contributions. Actual MFA/expiry/rate-limit behavior and
discovery remain unvalidated. Recurring sync/checkpoints, compact Strava discovery,
bulk archive and full UX remain subsequent phases; #99 stays open.

Validation: pinned local tool setup and 11 offline unit tests passed; optional
synthetic HTTP pipeline test passed (12 tests total with the local API enabled).
The clock-field regression uses a synthetic FIT user-profile message, following
a live parse failure fixed by supporting FIT time values. Root typecheck, tests
and build passed; unconfigured unrelated database suites were skipped. Fresh and
populated upgrade SQL paths through V124 and detail V002 passed against isolated
Postgres, with non-owner ownership/dispatcher tests. Subsequent live Neon Flyway validation and migration execution passed for both
databases, including the evidence-checked historical version alignment above. CI adds
a small offline Python gate; it never logs in to Garmin or downloads user data.

Standalone worker startup follow-up: inspected apps/worker/src/import-worker.ts,
apps/worker/package.json, scripts/dev.mjs, packages/db/src/pool.ts and index.ts,
packages/importers/src/upload-storage.ts, import-local.ts and dry-run.ts.
Direct worker startup validated role URLs before loading the root environment;
the combined dev launcher already loaded it. Bootstrap now loads the root .env
before configuration reads and resolves relative upload storage against the
repository root. Separate dispatcher/data-role requirements remain strict.
Worker typecheck and 3 existing provider unit tests passed; a package-directory
configuration smoke check loaded both required role URLs without exposing values.

Current integration status (2026-10-07): the investigation above records its
original phase and validation, not a claim that later work is still blocked.
The maintainer authorized merging the three delivery PRs. Current setup,
implemented behavior and remaining scope are maintained in ACTIVITIES.md,
GARMIN_SINGLE_ACTIVITY.md, AUTHENTICATION.md and ROADMAP.md. #97 is the completed
foundation; #99 incremental synchronization and #101 list-wide coverage remain
open follow-ups. Single-activity live retention/linking passed; browser visual
verification remains outstanding after permission was declined.
