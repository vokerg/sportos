# Worker idle compute: investigation and proposed wake-up design

Status: reviewed proposal, **not implemented or deployed**. Runtime work and live
acceptance belong to [issue #260](https://github.com/vokerg/sportos/issues/260).
Review date: 2026-11-17; inspected SportOS main: `747789a`.
This document records the maintainer-requested review, not authorization to
change production infrastructure, payments, network rules or database schema.

## Finding and confidence

The current worker repeatedly checks empty queues and updates Garmin presence.
This prevents normal Neon suspension even when useful processing consumes very
little CPU. Read-only inspection found no runnable jobs, continuing worker queue
traffic, an active primary compute and a suspended detail compute. Cumulative
queue and presence counters support the diagnosis, but do not measure one billing
period. Exact historical quota attribution remains unverified: the consumption
diagnostic failed and `pg_stat_statements` was not installed. No extension was
installed, statistic reset, job enqueued or live setting changed for this review.
Private inventory, connection details and activity/job counts are omitted.

Neon accounts for compute as allocated CU multiplied by running hours, rather
than measured CPU utilization. A continuously active 0.25 CU compute consumes
6 CU-hours/day or 180 CU-hours per 30 days. This is an illustrative baseline,
not a reconstruction of this account's invoice. Queries inside the default
five-minute inactivity window prevent scale to zero. See
[compute accounting](https://neon.com/docs/introduction/plans#compute) and
[scale to zero](https://neon.com/docs/introduction/scale-to-zero).

| Current implementation | Consequence |
| --- | --- |
| `import-worker.ts` starts separate import, rules, Daily, optional Strava and optional Garmin loops | Each enabled consumer creates independent idle traffic. Imports can add multiple consumers. |
| `polling-loop.ts` backs off only on connection errors | An empty queue never reduces scan frequency; outage retry also caps at only 30 seconds. |
| Import/rule/provider scans run stale recovery before every claim | Empty work still creates repeated transactions and lifecycle queries. |
| Daily and Garmin hardcode 1,000 ms | `IMPORT_JOB_POLL_MS` does not control all consumers. Even its current 60-second upper bound is shorter than normal suspension. |
| Garmin process presence is written every 20 seconds | Queue backoff alone cannot allow sleep. This is distinct from necessary active-job lease renewal. |
| Garmin capability **and enqueue** require a heartbeat newer than 90 seconds | An hourly cooldown copied from PCE would disable Fetch/Sync/Retry. Web and mobile also gate controls on this capability. |

The local PCE reference separates bounded database passes from a one-hour
cooldown and disconnects after each pass. Its independently tested `workers.dev`
gateway is evidence that the IPv4-to-IPv6 pattern is feasible, not evidence that
SportOS has a wake listener, compatible readiness or deployed transport.

## Proposed request path

```text
Authenticated browser/mobile action
  -> SportOS API: validate + commit owner-scoped job + release account connection
  -> bounded signed POST https://<worker>.<account>.workers.dev/wake
  -> separate Cloudflare Worker: authenticate, forward one fixed HTTPS request
  -> https://<verified-origin-hostname>/<dedicated-wake-path> over IPv6
  -> nginx -> SportOS loopback wake listener -> coordinator
  -> narrow dispatcher claims persisted work -> owner-scoped execution
  -> release all primary/detail pools when no runnable work remains
```

The VM and its listener stay running; only database work sleeps. A wake is a
hint to scan existing queues. It cannot select an owner, activity, job, SQL,
provider operation or destination. Official writes still require an existing
authorized job and a valid lease. No provider credentials or sports records
cross the gateway.

The API waits for a small, bounded notification attempt **after commit**, outside
the enqueue transaction/account connection. An initial implementation budget is
three seconds total, with no unbounded retries or detached fire-and-forget work
that depends on Render staying alive. A timeout must still return the committed
job and its ordinary queued state. Do not move notification into an enqueue
error/cleanup block that could delete an already accepted upload. Repeated active
job requests may notify again without creating another job.

Inventory actual producers, not just visible buttons: import upload/retry,
provider enqueue/retry, rule enqueue/retry, Garmin day/activity/sync/retry and
Daily calculation start/retry. Existing cancellation/disconnect semantics remain
authoritative; notify after successful cancellation where it expedites lifecycle
cleanup, without forcing a new unsafe claim or changing retry budgets. Future
webhook/operator producers require a wake hook or documented recovery latency.

The listener acknowledges promptly once it has recorded the scan request in
memory; it does not wait for provider download or scoring. That acknowledgement
is neither durable delivery nor job completion. If the process dies immediately
after acknowledgement, startup/recovery scans find the committed job.

## Domain, IPv6 and HTTPS review

The public gateway can use a free `workers.dev` name without buying a domain.
Workers Free currently includes 100,000 requests/day and 10 ms CPU/invocation.
Check shared account consumption and the deployed signature check's CPU budget;
invalid requests also consume quota. Keep the account on Free, without paid
bindings or automatic upgrade. Quota exhaustion can delay wake delivery; it must
not authorize spending. Other VM, Neon and network charges remain separate.
See [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
and [pricing](https://developers.cloudflare.com/workers/platform/pricing/).

**The public gateway does not supply the origin's DNS or certificate.** Workers
`fetch()` does not accept direct IP-address destinations; configure a fixed DNS
hostname resolving to the intended IPv6 origin, with matching publicly trusted
TLS and tested renewal. See [Worker subrequest limitations](https://developers.cloudflare.com/workers/platform/known-issues/).

An existing authorized HTTPS origin, such as the one used by the PCE reference,
may support a separately scoped nginx path forwarded directly to SportOS's
loopback listener. Verify that it is on the intended VM and preserve other
applications, authentication, issuer and routes. Do not proxy through PCE's API
or modify its gateway/secrets. If no origin can be reused, an operator-approved
hostname/certificate arrangement is a prerequisite. A free delegated hostname
can avoid buying a registered domain, but its DNS/ACME availability and renewal
must be verified; no such SportOS origin was validated in this review.

Earlier advice about proxied-zone Cloudflare Origin CA and Full(strict) described
a different topology. Do not assume it configures direct `workers.dev` fetches.
Use verified public TLS for this design; no self-signed/TLS-verification bypass.
The PCE reference nginx template uses publicly trusted ACME certificates.

Earlier Render IPv6 conclusions were also stronger than their source: the cited
[Render troubleshooting page](https://render.com/docs/troubleshooting-deploys)
discusses IPv6 listener/port binding, not proof of this API's outbound IPv6
behavior. The bridge deliberately avoids requiring outbound IPv6 from Render.
Acceptance must originate in the actual API runtime; a Mac connectivity test is
insufficient.

Verify IPv6 routes, DNS, SNI/Host and TCP/443 at both GCP and guest firewalls,
without introducing paid IPv4/NAT. Preserve IAP-only SSH. Allow only the narrow
approved HTTPS ingress; if source allowlisting is used, verify actual Worker
egress compatibility rather than assuming CDN ranges identify this Worker.
Headers or a Cloudflare source address alone never authenticate the request.
This ingress channel does not replace existing Neon/Strava/Garmin egress.

## Transport contract and abuse bounds

Use a separate SportOS Worker rather than extending PCE's broad API proxy.
The proposal permits only `POST /wake`, no query parameters, a fixed small body
and bounded headers/body read, including requests without Content-Length.
Pin the origin and destination path in operator configuration; never derive them
from caller paths, headers or payload. Disable redirects, caching, preview URLs
and application request logging. Cloudflare platform processing still applies;
disabling application logs is not a promise of no platform metadata.

Verify a versioned HMAC at the gateway before forwarding and independently at
the origin. Sign the version, fixed method/path, timestamp, nonce and exact body
bytes. Normalize the origin route explicitly if nginx maps a different external
path. Use a dedicated wake key, bounded clock skew and constant-time verification;
never reuse session/provider/encryption keys or transmit keys in URLs. Keep
operator-owned secrets outside Git, artifacts and public CI output and support
rotation with a bounded overlap.

At the VM, bound replay memory by freshness/size, and bound accepted wake rate
and scan frequency. Duplicate delivery can acknowledge an already accepted nonce
without scheduling another pass. Edge isolate memory is not a global replay
lock. Postgres claims/idempotency, not nonce memory, protect official effects.
No per-wake nonce/presence write to Postgres, KV or another storage service is
required. Invalid requests must never wake the DB. Authenticated flooding must
also be coalesced/rate bounded so the hint cannot create unlimited SQL traffic.
Return fixed sanitized errors and no job/owner/credential details.

## Worker lifecycle and durable scheduling

Replace perpetual per-queue loops with one coordinator that visits every
**enabled** queue fairly and retains existing concurrency bounds. Each processing
pass and claim batch is bounded; a backlog may schedule another pass immediately
without an idle scan storm. Acquire a dispatcher pool lazily, acquire worker-data
and detail pools only for actual work, and destroy all pools after the pass has
drained runnable work. A destroyed Kysely instance cannot be reused: recreate it
on the next pass and ensure no runner retains the previous pool.

Coalesce wake calls while running and use a generation/pending-wake check across
the final scan and pool destruction. A wake arriving while closing must request
another pass, not disappear into a stale `running` flag. On SIGTERM stop new
claims, retain existing lease-safe completion/abort behavior, close pools and let
the next process recover. There is no persistent DB LISTEN connection, idle
presence timer or SQL-based health check. Active-job heartbeat/lease renewal
continues while a job actually runs. API `/health` already returns process state
without SQL; preserve that property.

Schedule scans from three sources:

1. A startup scan and an authenticated explicit wake.
2. An in-memory timer for the earliest persisted future due job or lease expiry
   observed during a pass. Use only narrow dispatcher lifecycle metadata; never
   worker-data credentials for cross-account discovery. Future-due work is not
   runnable: close pools while waiting. Re-read state at the deadline; handle
   clock/boundary races with a small bounded retry, not a busy loop.
3. A recovery scan once per hour while healthy and idle, for lost notifications,
   external producers and missed cross-process state changes. A persistent DB
   outage must back off to a similarly long idle interval after bounded attempts,
   with bounded explicit wake attempts, instead of retaining a 30-second loop.

After restart, rebuild timers from Postgres; timers are not durable authority.
Known Garmin/Strava rate-limit deadlines must not wait for the next hourly tick.
Garmin sync and Daily calculation requeue continuation days: keep draining them
fairly until complete. Work leased elsewhere schedules stale recovery rather
than immediate reclaim. Future lifecycle-query grants/types, if needed, require
an append-only migration and non-owner-role tests; no broad data access.

## Garmin readiness and client behavior

In wake mode, a deployment's explicit configured execution capability plus the
owner's ready Garmin connection determines whether a request can be queued.
Do not require a recently updated shared heartbeat or contact Garmin to answer
capability. The configured capability does not assert current network/provider
health. If the transport is down, accept a valid job and show queued/check-status
behavior; disconnected/reauthorization-required credentials remain blocked.
Expose only user-safe status, never worker hosts/keys/owners.

Update both the repository's enqueue check and API capability output; changing
UI text alone leaves the database-side enqueue blocked. Web/mobile controls must
allow status/cancel/manual refresh independently of execution availability and
distinguish queued, running, rate limited, failed and completed. Keep bounded
client polling and teardown cancellation. No periodic browser readiness probe or
new SQL timer should replace the removed heartbeat.

Deploy this compatibly: clients and API must tolerate the transition before the
worker stops advertising legacy readiness. Old clients must not become unusable
on day one; document any required mobile update before activation. Rollback must
restore a matched API/worker/readiness mode without deleting jobs or credentials.

## Failure and cost expectations

| Event | Required result |
| --- | --- |
| Enqueue transaction rolls back | No wake and no accepted job. |
| Enqueue commits; wake times out, is lost or hits Free quota | Job stays queued; a later explicit wake/startup/hourly scan finds it. Never claim immediate processing. |
| Wake accepted; process crashes | Persisted job survives; startup recovery and leases govern execution. |
| Duplicate/replayed wake; two worker instances | Bounded hints, valid claims only, no duplicate canonical/scoring effects. |
| New wake during idle transition | Another pass runs even if pools were just destroyed. |
| Provider reschedules, or another worker holds a lease | Preserve persisted deadlines; schedule a local future scan and release pools. |
| Invalid request or liveness check | No DB connection, helper call or provider operation. |
| No work, no clients, no other consumers | Worker traffic stops and Neon can suspend. |

At a five-minute suspension timeout, an hourly empty recovery scan can itself
keep compute active for roughly five minutes per hour: about 15 CU-hours per
30 days at 0.25 CU, plus scan duration, real usage and other clients. This is an
estimate, not guaranteed savings. Frequent user actions, retries or other API/
browser/local-worker traffic can keep Neon active legitimately. Audit every
worker instance: one unchanged local consumer defeats this design's idle goal.

## Validation and activation gates

Issue #260 owns the implementation checklist. Before activation, require:

- Focused coordinator/API/gateway tests for commit ordering, all queue types,
  duplicate/lost/late wake, startup, cancellation, continuation, retry deadlines,
  stale leases, shutdown, DB outages and pool cleanup on success and failure.
- Transport tests for forged/stale/replayed signatures, method/path/host/query
  rejection, bounded streamed bodies, redirect/destination injection and safe
  errors. Preserve positive/cross-owner tests and dispatcher denial checks.
- API and web/mobile tests showing sleeping workers do not disable Garmin
  enqueue, check, cancel or retry; retain credential and polling boundaries.
- An authorized live Render -> Worker -> GCP IPv6 smoke test with real DNS,
  valid TLS/SNI/renewal configuration, firewall and signature validation. Exercise
  authentication/transport failures without changing official records. Local
  fake-fetch gateway tests cannot prove this route.
- A controlled empty-queue observation: stop/identify other consumers, close
  clients, verify worker SQL/presence traffic stops and both project pools close,
  then observe suspension through Neon control-plane data. SQL diagnostics or
  database health probes would themselves wake the compute. Enqueue explicitly
  afterward and verify prompt processing, suppressed-wake recovery and restart
  reconstruction of delayed work.
- A stated before/after usage window with active-time/CU-hour and queue-activity
  evidence. Separate other-client traffic and incomplete billing visibility.
  Do not reset statistics or install diagnostic extensions without authorization.

Roll out the independently reviewable API/client/readiness, coordinator/listener,
gateway and operator configuration in a tested compatible sequence. Keep an
explicit rollback to a matched release/configuration. Legacy polling is a costly
temporary rollback, not successful remediation. Do not silently downgrade wake
mode to frequent polling after a transport failure.

This review authorizes no activation. Preserve `SPORTOS_IMPORT_WORKER_ENABLED=false`
on GCP until API-upload originals are available there, persistent Garmin original
storage, separate roles/keys, provider egress and the Oracle #95 hold. No canonical
or scoring policy changes, bulk fetch, new paid service or PCE production changes
are included.

## Investigation record and documentation alignment

Reviewed open issues/bodies and PRs, no duplicate implementation or active claim,
and recent merges through #257/#259 before branching from current main. Relevant
mismatches: deployment prose omitted Daily processing; ADR 0012 still labelled
initial deployment pending; README's schema summary lagged the append-only files.
This documentation update corrects those summaries while explicitly leaving the
currently shipped polling/heartbeat behavior in place.

SportOS files inspected before documentation edits (relevant sections included):

- `AGENTS.md`, `README.md`, root `package.json`; `docs/ARCHITECTURE.md`,
  `ROADMAP.md`, `AUTHENTICATION.md`, `AI_ANALYSIS.md`, `FRONTEND_ARCHITECTURE.md`,
  `DEPLOYMENT.md`, `GARMIN_WORKER.md`, `gcp-worker-deployment.md`, ADRs 0003/0012.
- `apps/worker/src/import-worker.ts`, `polling-loop.ts`, `polling-loop.test.ts`,
  `import-job-runner.ts`, `provider-sync-runner.ts`, `rule-change-runner.ts`,
  `garmin-job-runner.ts`, `daily-recalculation-runner.ts`; worker `package.json`.
- `packages/db/src/pool.ts`, repositories `worker-dispatch.repository.ts`,
  `garmin-jobs.repository.ts`, `daily-recalculation.repository.ts`;
  primary migrations V143 and V148; migration filenames through V149.
- `apps/api/src/db.provider.ts`, `health/health.controller.ts`,
  `garmin/garmin-jobs.service.ts`, `daily/daily-recalculation.controller.ts`,
  `daily/garmin-day.service.ts`, `imports/imports.service.ts`,
  `providers/providers.service.ts`, `rules/rules.service.ts`.
- Web `features/providers/ui/garmin-sync-control.component.ts` and relevant
  Daily Garmin availability template; mobile `src/providers/GarminSyncCard.tsx`.
- `deploy/gcp/sportos-worker.service`, `worker.env.example`,
  `.github/workflows/gcp-worker-deploy.yml`, `scripts/deploy/change-scope.mjs`.

External local PCE references inspected: `docs/26-worker-deployment.md`,
`docs/29-gcp-api.md`, `apps/worker/src/db-jobs-runtime.ts`,
`deploy/gcp/edge-proxy.mjs`, its example Wrangler config and node tests,
and the example nginx TLS configuration. They are design precedent only;
SportOS must have its own tests, keys, configuration and acceptance evidence.
