# On-demand worker mode

Implementation: merged [PR #262](https://github.com/vokerg/sportos/pull/262), tracked by
[issue #260](https://github.com/vokerg/sportos/issues/260). The GCP worker, Render
settings and gateway were activated on 2026-11-17. Signed gateway acceptance and
actual Neon suspension passed; the authenticated Render application trigger
remains unobserved. See the [activation record](implementation/issue-260-activation.md).
[The idle-cost review](WORKER_IDLE_COST.md) explains why
frequent empty polling and process-presence writes prevent Neon suspension.

## Modes and authority

`SPORTOS_WORKER_MODE=poll` remains the default for existing deployments. It keeps
the existing loops/heartbeat and their idle costs. `wake` starts an HTTP listener
on **127.0.0.1 only**, scans once at startup, drains enabled queues, destroys all
primary/detail Kysely pools, then waits without SQL. pg pools are lazy: empty
passes connect only the dispatcher, not worker-data or detail storage.

A pass visits import, rule, Daily, Strava and Garmin handlers fairly, with at most
25 rounds before yielding to another pass. Import concurrency stays bounded by
the existing setting. Disabled consumers are excluded from both claims and
deadline discovery. GCP must retain `SPORTOS_IMPORT_WORKER_ENABLED=false` until
the worker has access to API-upload originals. Preserve persistent Garmin FIT/ZIP
originals and the Oracle hold.

Postgres remains the sole authority for claims, owners, retry deadlines, leases,
cancellation and completion. The dispatcher reads only existing lifecycle grants;
account data still uses `withAccountContext` and the separate worker-data role.
No new migration or grants are needed. Candidate claims now use explicit SQL
`LIMIT 1`, rather than assuming `executeTakeFirst()` limits a selection.

## Configuration

The API and GCP worker have separate environments. Put real hosts, keys and
inventory only in protected operator configuration, never repository examples.

| Setting | Process | Meaning |
| --- | --- | --- |
| `SPORTOS_WORKER_MODE=wake` | Worker | Enable disconnected idle mode; default is `poll`. |
| `SPORTOS_WORKER_WAKE_PORT=3113` | Worker | Loopback listener port, integer 1024–65535. Match nginx. |
| `SPORTOS_WORKER_WAKE_KEYS=k1=<base64>` | API + worker | Dedicated HMAC ring, up to three named keys, each exactly 32 decoded bytes. |
| `SPORTOS_WORKER_WAKE_ACTIVE_KEY_ID=k1` | API | Key ID used to sign hints. |
| `SPORTOS_WORKER_WAKE_URL=https://<worker>.<account>.workers.dev/wake` | API | Fixed gateway URL. Unset means no notifications. HTTPS hostname required. |
| `SPORTOS_GARMIN_EXECUTION_ENABLED=true` | API | Allow owner-ready Garmin requests while the worker sleeps; not a claim of transport/provider health. |
| `WAKE_KEYS=k1=<base64>` | Cloudflare Worker secret | Same dedicated ring, independently verified at edge and VM. |
| `PUBLIC_ORIGIN` | Cloudflare Worker | Exact public HTTPS origin without a path. |
| `UPSTREAM_WAKE_URL=https://<verified-origin>/sportos-worker/wake` | Cloudflare Worker | Fixed HTTPS DNS destination and dedicated route. |

The Garmin execution flag has three states: unset preserves legacy recent-heartbeat
behavior, `true` allows queueing with a ready owner connection, `false` disables
new execution. The API validates it at startup. Its repository enqueue check
receives the same setting, including retry paths. Existing web/mobile capability
contracts remain compatible; configured/sleeping is still `enabled: true`.
Status/cancel are not new execution, and mobile manual job checks no longer
require current execution availability. Reauthorization remains required when
credentials are not ready.

Never reuse provider encryption, authentication/session or PCE keys. For rotation,
first install old/new keys at origin, gateway and API; switch the API active ID
last. Keep the old verification key for in-flight hints/freshness overlap, then
remove it everywhere. Maintain clock synchronization. No key or signature belongs
in a URL, log, example, artifact or public workflow.

## Gateway and origin

`deploy/worker-wake/worker.ts` is a separate, stateless Workers Free application.
Copy its example Wrangler config to protected operator state and set its `main`
to the reviewed module path. Keep observability and preview URLs disabled;
set the key ring using Worker secrets, not `vars`. No KV, D1, Cron, Durable Object,
paid binding, account upgrade or PCE gateway edit is needed.

An owned registered domain is not required for the public `workers.dev` address.
The **origin still needs a DNS hostname**, working IPv6 ingress and a matching,
publicly trusted renewable certificate. A raw IPv6 literal is rejected; Origin
CA/Full(strict) instructions for a proxied Cloudflare zone are not setup steps
for this direct Worker fetch. Reusing an existing TLS listener requires an
explicit, separate SportOS route that does not pass through PCE's application.
The activation reused an existing valid public certificate and active renewal
setup; no new hostname purchase or firewall rule was necessary.

The nginx location example maps only `/sportos-worker/wake` to loopback `/wake`,
sets `Host: localhost`, and forwards only the signature/content type. Install it
inside an already verified HTTPS server block; it does not provision DNS, TLS
or firewall rules. Keep IAP-only SSH and existing services unchanged. Verify any
source allowlist against actual Worker egress; the HMAC is required independently
of source addresses and forwarding headers.

Only `POST /wake` with the exact two-byte body `{}` is accepted. HMAC v1 binds
the fixed method/path, key ID, timestamp, nonce and exact body. The edge rejects
unauthenticated traffic before forwarding; the origin independently verifies
the signature, body, route and loopback Host. Requests must be within 60 seconds
of the local clock. Replay memory is bounded to 256 accepted nonces, retained
for 121 seconds; repeated accepted nonces do not trigger additional scans.
Fresh hints inside a two-second interval are acknowledged and coalesced into a
deferred wake, so a legitimate burst does not disappear after the final scan.
Capacity exhaustion returns 429 and leaves durable recovery authoritative.

Streamed bodies are byte-bounded without trusting Content-Length. Edge body and
upstream waits are two seconds; the listener has three-second socket/request
timeouts. Redirects are not followed, credentials/cookies/forwarding headers are
not forwarded, and responses are empty/sanitized with `Cache-Control: no-store`.
Cloudflare still processes platform metadata; disabled application logs are not
a promise of no platform processing.

Workers Free quotas (currently 100,000 requests/day and 10 ms CPU/invocation) are
shared constraints to verify before deployment. This code is not a paid fallback.
Recheck [current pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and measure the deployed signature path's CPU budget. Quota exhaustion, DNS/TLS
failure or gateway outage delays hints; no production upgrade is authorized.

## Commit ordering, recovery and shutdown

API enqueue/retry/cancel paths notify after the full account-context operation
has returned, including transaction commit and connection-context cleanup. Import
notification is outside upload error cleanup. The API awaits one attempt bounded
to three seconds; rejected/rolled-back operations do not notify. A failed hint
does not turn a committed job into an enqueue failure or delete its source.
Only a fixed sanitized warning is logged. Reads never notify.

An HTTP 202 means the worker accepted an in-memory scan hint, not that a job is
durably delivered or completed. A wake received while processing or destroying
pools remains pending. Concurrent hints never create overlapping coordinators.
Job execution and active-job lease heartbeats continue to use existing runners.

After an idle pass the coordinator schedules the earliest future `next_attempt_at`
or running lease expiry from enabled queues, plus a recovery scan in one hour.
An overdue row that could not be claimed also backs off from one second up to
one hour, avoiding a permanent tight loop on locked or ineligible work.
Garmin/Daily continuation days drain without waiting an hour. Process restarts
reconstruct deadlines from persisted state. Connection failures release pools
and back off exponentially from one second up to one hour; explicit hints can
accelerate recovery at most once a minute during an outage. SQL/programming
errors remain fatal rather than silently retried. Shutdown stops claims, lets
existing runner semantics fence/finish work, closes pools and the listener, and
leaves interrupted work for durable lease recovery.

If a post-commit hint is lost, a new explicit hint, restart or hourly scan recovers
it. Worst-case fallback latency can be about an hour plus preceding work/outage
duration. A new external producer needs a hook or that documented latency.
The hourly scan has a residual compute cost; see the review's estimate. Other
clients or an unchanged local worker can still keep Neon awake.

## Staged operator activation and rollback

This procedure requires applicable operator authorization. The dated activation
record above distinguishes completed live steps from still-unobserved checks;
the procedure itself is not permission to change cloud/host/payment settings.

1. Deploy matching reviewed API/worker code with existing polling/readiness defaults.
   Verify packaging, separate runtime roles, persistent originals and provider egress.
2. Prepare the independent Free gateway and verified origin/TLS/nginx path, private
   keys and rollback configuration. Do not alter PCE's routes or buy IPv4/NAT.
3. Configure the API wake URL/key and explicit Garmin execution capability before
   stopping legacy worker heartbeats. While the listener is unavailable, hints may
   fail safely and the old polling worker still handles committed jobs.
4. Switch the worker to `wake` with matching keys/port and restart only its service.
   Validate the route from the real Render runtime, then authorized explicit work,
   signature rejection and missed-wake/deadline/restart recovery. Use synthetic
   fixtures where possible; do not download personal data or recalculate official
   records merely as an infrastructure probe without explicit scope.
5. Identify all consumers, deliberately stop/update obsolete local polling workers,
   close clients, and observe disconnected pools and Neon suspension through the
   control plane. Do not use SQL health probes to measure sleep. Record a bounded
   before/after active-time/CU-hour window and confounding traffic.

For rollback, restore a matching polling worker first and verify it advertises
legacy readiness, then remove/restore API execution/wake settings as appropriate.
Preserve job/credential/source state and original storage. Do not automatically
fall back to frequent polling on each delivery failure. No existing migration or
heartbeat table is removed, so the compatibility path stays available.

## Local validation

Use pnpm. Focused contracts: `pnpm --filter @sportos/worker-wake test`,
`pnpm test:wake-gateway`, API `src/jobs/worker-wake.test.ts`, worker
`src/wake-{coordinator,listener}.test.ts` and `src/worker-pass.test.ts`.
The gateway tests use fake upstream fetches and cannot prove IPv6/TLS reachability.

`scripts/test-garmin-worker-db.mjs` requires an explicitly supplied fresh disposable
loopback cluster. It migrates fresh/populated primary/detail databases and runs
non-owner-role tests, including wake-mode Garmin capability/enqueue without fresh
presence and dispatcher deadline reads. It does not use production Neon or Garmin.
The implementation record and PR list actual checks and remaining live gates.
