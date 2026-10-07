# Local single-activity Garmin Connect proof

This is the first phase of #99, stacked on #97. Full archive #98, recurring
incremental jobs, compact-Strava discovery search, #101 UI and #102 preflight are
not implemented by this phase. The supplied Garmin ID is a targeted lookup; no
other activity catalog or wellness data is downloaded. No scoring changes occur.

This optional local tool uses the **unofficial/private** Garmin Connect API
through pinned `python-garminconnect` 0.3.17. Endpoints can change, fail MFA or
anti-bot checks, be rate limited, or be restricted by Garmin's terms. It is not an
official Garmin developer integration. Authentication is initiated by the user
in their terminal; the agent/browser never extracts cookies or supplies passwords.
Garmin tokens stay in a protected local directory outside Git. Plaintext passwords
are never written to files, backend databases, HTTP activity payloads or logs.

## Extract locally first

Requires Python 3.12+ and pnpm. Setup creates an isolated environment under
`~/.local/share/sportos/garmin/venv`, not a Python dependency in API/worker runtime.

```bash
pnpm garmin:setup
pnpm garmin:login
pnpm garmin:activity -- --activity-id <GARMIN_ACTIVITY_ID>
```

`garmin:login` prompts for email/password/MFA locally and saves reusable SDK tokens
under `~/.local/share/sportos/garmin/tokens` (directory 0700, files 0600). It tries
one interactive login, with the SDK's finite authentication strategies; it does
not loop on failed credentials or automatically prompt while importing. Future
activity runs reuse supported tokens/refresh. Expiry, revocation or 403 requires
explicit `pnpm garmin:login` again. Do not paste credentials into chat, pass them
as process arguments, commit them, or enable upstream debug logs. The wrapper
suppresses upstream logging and prints only bounded status/error classifications.

Default extraction writes private artifacts under
`~/.local/share/sportos/garmin/sources`, rejecting repository paths and symlinked
storage/token directories. Original metadata/bytes are retained before decoding,
including when a corrupt FIT, unknown sport or multisession activity fails.
Failed input remains local raw evidence and does not commit a canonical fact or
advance a successful cache marker. Original files must contain one bounded FIT
activity (direct FIT or a safe original ZIP with one FIT member); this is not a
full-account archive reader.

A successful command prints message counts, retained byte count and cache status.
It does not print names, dates, GPS coordinates, raw fields, provider IDs, storage
paths/hashes or passwords. Full original FIT/ZIP and JSON, decoded FIT messages,
unknown/developer fields and their units/raw values stay private. Session/lap/
record/event/set messages are retained together in generic resource chunks;
telemetry is not promoted to canonical metrics. Strength endpoint data is retained
as returned; a 404 is explicitly unavailable, and units are not guessed.

FIT parsing uses pinned `fitdecode` 0.11.0 with strict CRC and parse errors.
Canonical matching metadata uses explicitly supported Garmin activity types,
`startTimeGMT`, distance, `movingDuration` and `elapsedDuration` (or original FIT
`total_elapsed_time`). FIT timer time is **not** guessed to be moving time.
Unknown source semantics require review. The selected live sample passed strict
parsing and retained running dynamics and power. Availability varies by device
and activity; null or unavailable fields are preserved without fabrication.

## Retain in SportOS after reviewing the local proof

Deploy/run the #97/#99 API changes first, with primary V124 and dedicated detail
V002 applied through the usual separate Flyway identities. Configure the existing
`SPORTOS_UPLOAD_DIR` for durable original objects; a transient Render filesystem
needs backup/persistent storage before this is operational. Original-byte hashes
and private opaque object keys stay in the separate detail manifest, never primary
`source_records` or public responses.

```bash
pnpm garmin:activity -- --activity-id <GARMIN_ACTIVITY_ID> --import
```

Default API is `http://127.0.0.1:3010`. The API's explicitly configured local
`dev-single-user` mode needs no CLI session credential; it still chooses the
fixed legacy account server-side. For the hosted personal password mode:

```bash
pnpm garmin:activity -- --activity-id <GARMIN_ACTIVITY_ID> --import \
  --api-base https://<sportos-api-host> --web-origin https://<sportos-web-host>
```

The CLI prompts for SportOS username/password separately. It uses a new opaque
server session and the session-bound `x-sportos-csrf` cookie/header pair; cookies
stay in memory and logout is attempted on completion/failure. OIDC CLI login is
not implemented; use the approved local development or hosted personal-password
mode. Never disable hosted authentication or copy browser cookies as a workaround.
Only HTTPS or loopback HTTP API origins are accepted; redirects are refused.
Owners/actors are never flags or body fields and always come from the API session.

The API accepts bounded multipart JSON resource chunks and an original file,
retains them under the authenticated owner in the separate detail/object stores,
and verifies the complete declared resource coverage and original hash before
committing compact metadata through the shared #97 resolver. Partial failures
preserve prior resources and can be replayed idempotently. An original object
missing from local blob storage may be restored at its existing immutable key
from the exact retained bytes; corrupt existing objects require restoration.

Matched workouts retain one canonical activity with unchanged Strava/workbook/
manual fields and scores. Garmin-only or ambiguous observations remain staging
records. Read/review via `/garmin/activities`; explicit accept/reject/manual-link
and reverse reconciliation are described in [ADR 0010](adr/0010-garmin-activity-reconciliation.md).
No activity-page Garmin download or bulk rich Strava request is introduced.

## Cache and bounds

The first network step is metadata. It checks an authenticated remote native
identity/detail cache (when `--import` is selected) and then complete local
content-addressed artifacts. Current retained data skips original FIT, details
and sets network calls. Local hashes are verified; remote coverage includes every
declared chunk and verifies that original bytes are available. Re-fetch new/
changed/missing resources, or use explicit `--force-refresh`. Original source
versions are retained and linked canonical UUIDs are never silently retargeted.

Per single run: at most 20 streamed activity/profile API requests, spaced by at
least 0.5 seconds; connect/read timeouts 10/30 seconds; no wrapper retries.
Original download/expanded FIT totals are bounded to 20 MiB; ZIP members to 16,
expansion ratio to 200, exactly one FIT; decoded data to 200,000 messages and
64 MiB serialized content. JSON resources are chunked below 4 MB with at most 100
resource descriptors. The original raw copy plus derived source version may
occupy additional bounded disk space. This reader holds the bounded single
activity in memory; it is not a streaming bulk importer and has no persistent
SQLite cache or third SportOS database.

401 permits the SDK's bounded supported token refresh; persistent 401/403 aborts
with reauthentication guidance. 429 aborts with a retry-later classification,
without a retry loop, cursor advance or provider-job retry consumption. The CLI
uses no durable incremental cursor in this phase. Network errors, incompatible
responses and cancellation leave previous successful cache markers intact.
Cancellation may leave safe uncommitted auxiliary resources; replay converges.

## Validation and remaining acceptance work

```bash
pnpm garmin:test
pnpm --filter @sportos/api test -- src/activities/garmin-local-ingest.controller.test.ts
pnpm typecheck
```

The optional synthetic HTTP check requires an isolated local API and test
primary/detail databases with non-owner runtime roles; it never connects to
Garmin. Set `SPORTOS_GARMIN_TEST_API_BASE` to that loopback API and run
`pnpm garmin:test`. It verifies raw/resource upload, unlinked staging, idempotent
replay and metadata-only second-run behavior. Never point fixtures at production.

No live personal sample, credential or activity identifier is committed.
User-initiated terminal sign-in, selected activity download, strict FIT parsing,
repeat cache reuse and a read-only unique match to existing Strava data passed.
Browser access was declined; browser credentials were never extracted.
Live SportOS retention and a strong unique link to the existing Strava activity
passed after applying primary V124 and dedicated detail V002 with separate
schema-owner identities. A second import reused the remote cache. Canonical
activity facts and official scores were verified unchanged. Fresh environments
still require the primary and detail migration settings configured locally,
never in chat. Listing/discovery, actual
MFA/expiry/rate-limit behavior and broader device/strength coverage remain
unvalidated. #99 stays open/draft until its remaining delivery phases and
acceptance criteria are met; #98 remains deferred.

Upstream contracts:
- [python-garminconnect 0.3.17](https://github.com/cyberjunky/python-garminconnect/tree/0.3.17)
- [fitdecode reader](https://fitdecode.readthedocs.io/en/latest/reference/reader.html)
