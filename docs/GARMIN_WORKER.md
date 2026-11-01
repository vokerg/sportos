# Durable Garmin Fetch/Refresh

Day and activity Fetch/Refresh run as durable Postgres jobs. The API authenticates,
validates and enqueues; a configured worker executes the existing bounded Python
helper, retains originals and projects/reconciles evidence. API and worker may run
on different machines. Neither the phone nor hosted API needs an inbound
connection to the worker, a Python installation, or local Garmin token files.

This supports targeted day/activity requests, not archive import or automatic
scoring. Recalculate remains an explicit retained-data-only operation. GETs do not
start provider downloads. Strava remains authoritative for its canonical metrics;
Garmin matching, walking policy and immutable source history are unchanged.

## Setup

Apply primary Flyway V143–V144 and separate detail V005–V006. The detail database
requires a dedicated non-owner worker login with membership in
`sportos_worker_data`. V006 grants database CONNECT; table grants alone are
insufficient because V001 revoked PUBLIC connection access. Never use the API or
schema-owner login for a running worker.

On the trusted workstation, establish Garmin login as before:

```sh
pnpm garmin:setup
pnpm garmin:login
pnpm garmin:import-session -- --legacy-account
```

The user enters passwords/MFA in the terminal. Import validates the existing
protected session file, extracts only the pinned SDK's three session fields,
encrypts them and binds them to the maintained account/connection. It does not
store a password, profile or email as ownership identity. The initial operator
command deliberately supports only the existing maintained legacy account; it is
not a public multi-user Garmin sign-in flow. Other owners cannot borrow that
session. Import is rejected while a connection has queued/running work.

The connection records the trusted workstation's IANA time zone. API future-date
validation and worker day checks use that calendar independently of server time
zones. Do not infer an account's Garmin calendar from a browser or provider UTC
start time.

Configure the worker's private environment:

```dotenv
SPORTOS_GARMIN_WORKER_ENABLED=true
SPORTOS_WORKER_DATABASE_URL=<primary-dispatcher-login>
SPORTOS_WORKER_DATA_DATABASE_URL=<primary-owner-scoped-worker-login>
SPORTOS_ACTIVITY_DETAIL_WORKER_DATA_DATABASE_URL=<separate-detail-worker-login>
SPORTOS_PROVIDER_CREDENTIAL_KEYS=<existing-versioned-key-ring>
SPORTOS_PROVIDER_ACTIVE_KEY_ID=<active-key-id>
# Optional; default is the isolated garmin:setup interpreter.
SPORTOS_GARMIN_PYTHON=<absolute-interpreter-path>
SPORTOS_UPLOAD_DIR=<persistent-private-original-storage-directory>
```

Run `pnpm dev:worker` or the built worker entry. The worker must have the pinned
`tools/garmin/requirements.txt` environment, repository helper code and persistent
original-file storage. Retained JSON remains in the separate detail database;
original FIT/ZIP bytes remain outside Postgres. An operator moving/replacing a
worker must preserve the blob backend or allow explicit original recovery before
claiming its cache is complete. Hosted source views read retained database
resources, not worker-local artifact paths.

`SPORTOS_GARMIN_LOCAL_FETCH_ENABLED` is a compatibility setting for older direct
helper tools. It no longer enables API Fetch/Refresh. The API reports availability
from the account's connection status plus a ready worker heartbeat newer than 90
seconds. A worker checks its Python interpreter before advertising readiness;
credential decryption and actual provider availability are validated on execution.

## Credential boundary

`garmin_connections` stores owner-bound status, revision and calendar metadata.
`garmin_credentials` stores only a bounded AES-256-GCM envelope with random nonce,
versioned key ID and authenticated data binding owner, connection, Garmin and
session format/version. The API and dispatcher cannot read session ciphertext.
The owner-scoped worker-data role alone reads/rotates it. Encryption keys stay in
private runtime configuration, outside the database; retain old keys during
rotation. Never log a session, helper stdin/stdout or credential envelope.

The pinned SDK supports in-memory session import/export. `worker_bridge.py`
accepts a fixed bounded private stdin protocol and returns updated session state
only to its parent worker. It accepts no password, owner, arbitrary URL, path or
shell operation. It never writes session files. Updated sessions are encrypted and
committed under the current fenced job lease before their operation result is
used. Connection revision checks prevent overwriting another credential update.

Expired/rejected credentials produce `GARMIN_REAUTHORIZATION_REQUIRED`. Reconnect
with a fresh interactive login and explicit import after active work is terminal.
The original workstation token file is not kept in sync with worker rotations;
reimporting an old file is not a substitute for reconnecting.

## API and clients

- `GET /garmin/connection`: current account capability and active job metadata.
- `POST /daily/:date/garmin` and `POST /activities/:id/garmin-detail`: return HTTP
  202 with public job metadata; body permits only `refresh`.
- `GET /garmin/jobs/:id`: owner-scoped status.
- `POST /garmin/jobs/:id/cancel`: request cooperative cancellation.
- `POST /garmin/jobs/:id/retry`: enqueue a new bounded attempt after failure or
  cancellation. Empty mutation bodies; normal browser CSRF/native bearer auth.

Foreign and missing identifiers produce the same generic response. Public jobs
contain target, status, phase, attempt count and allowlisted error code, never
owners, leases, credentials, raw results or local storage paths.

A connection serializes requests because its refresh credentials may rotate.
Identical active requests return the same job; another target gets a busy result.
Later requests for the same date are allowed. Exact retained source bytes converge;
changed evidence adds immutable versions. Terminal failures retain successful
categories and previous versions. Durable rate-limit rescheduling waits 15 minutes
without consuming the retry budget; stale leases recover with bounded attempts.
An orderly worker interruption releases work for later execution. Only the current
lease holder may publish primary/detail/blob results; repository-owned transactions
compose with the worker's fencing transaction. Immutable auxiliary retention may
safely outlive an interrupted cross-database publication.

Web and native submit jobs and poll status, then reload retained day/activity data.
Web uses the shared durable-job poller, capped at 120 checks/10 minutes. Native
checks at most 24 times over two minutes. Both offer manual continuation,
cancellation and retry. Screen teardown stops transport/polling, not the server
job. Reopening discovers active work. Navigation never enqueues a new fetch.

## Validation

`node scripts/test-garmin-worker-db.mjs` requires a fresh loopback-only disposable
Postgres cluster through `SPORTOS_GARMIN_DISPOSABLE_ADMIN_URL`. It runs Flyway fresh
and populated upgrades for both databases, verifies retained fixture survival and
CONNECT grants, and executes the non-owner worker suite. CI runs this without
private database secrets. The normal Neon migration/role gates remain in place.

Implementation and sanitized live validation: [issue 226](implementation/issue-226.md).

## GCP hosting

See [native GCP worker deployment](gcp-worker-deployment.md) for GitHub merged-PR
deployment, systemd and manual service controls. The package includes the pinned
Python helper and installs its wheels offline. This is prepared infrastructure,
not evidence of a deployed worker; egress, credentials, migrations and source
availability must be verified before activation.
