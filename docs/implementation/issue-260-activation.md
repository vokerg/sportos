# Issue #260: production wake configuration — 2026-11-17

The maintainer explicitly authorized merging PR #262 and continuing with live
configuration. The implementation was squash merged as `1ab085c` (`r000162`).
Its merged-PR GCP workflow passed validation, Linux packaging and deployment;
the guest revision independently matched. The Render configuration deployment
of that same source is live. This record contains no actual infrastructure
identifiers, URLs, credential values or private sports/job content.

## Applied configuration

- Created a separate SportOS Worker on the existing Cloudflare account, using
  a `workers.dev` public name. Its fixed HTTPS origin points to a dedicated
  SportOS path on the already configured IPv6 TLS listener. No domain purchase
  or raw-IP fetch was required.
- Uploaded the reviewed bundle, two plain URL bindings and one dedicated
  `secret_text` HMAC ring. Subdomain enabled, previews disabled; no KV, D1, R2,
  Cron, Durable Object or database binding. Readback confirmed the intended
  compatibility date/binding names and Logpush false. No app request logging.
- Added one exact nginx path forwarding to `127.0.0.1:3113/wake`, with fixed
  Host, bounded body/timeouts and restricted headers. `nginx -t` passed before
  reload. Existing public certificate, active renewal timer/hook, firewall,
  IAP access and unrelated application routes were preserved.
- Updated only the four Render wake/capability environment values. Their
  readback matched; digests confirmed every unrelated existing value unchanged.
  No application password, authentication identity or provider credential changed.
- Installed the same dedicated HMAC ring in the protected worker env, enabled
  `SPORTOS_WORKER_MODE=wake`, and restarted only SportOS. Upload imports remain
  disabled; Garmin/provider configuration and private original storage remain.
  Protected configuration/route rollback copies were retained outside Git.

No new VM, address, NAT, disk, bucket, firewall/IAM change, subscription/payment
write, paid binding or PCE application change was performed. Other hosted
services retained their original process identities and restart counts; the
existing unrelated gateway remained healthy after nginx reload.

## Observed acceptance

The local signed listener hint returned 202. Through the public Cloudflare route:

| Probe | Observed HTTP status |
| --- | --- |
| Wrong method (GET) | 404 |
| Unsigned POST | 401 |
| Stale signature | 401 |
| Oversized body | 400 |
| Valid signed hint | 202 |
| Replay of accepted hint | 202, without duplicate scheduling |

A representative valid round trip was approximately 0.64 seconds. These are
transport/functional observations, not numerical CPU-time measurements. Probe
bodies contained only `{}`; no provider/scoring job or personal record was
created to perform this infrastructure check.

After the passes, one bounded diagnostic using the dispatcher role found no
other API/dispatcher/worker-data connections and no queued/running enabled jobs.
No local SportOS worker process was found at inspection. SportOS remained active
with no automatic restart after the deliberate configuration switch.

SQL observation then stopped. The Neon control plane reported the primary
compute **idle/suspended at 06:26:01 UTC**, about five minutes after the final
diagnostic connection closed. This is actual suspension evidence; the worker's
HTTP listener remained available without a database connection. Control-plane
inspection does not issue SQL or wake the compute.

A second signed public hint at 06:29:17 UTC returned 202 in about 0.90 seconds
while the compute was suspended. The control plane then reported a fresh
compute start at 06:29:18 UTC. This verifies wake from suspension through the
public gateway; it does not verify an authenticated Render API mutation.
With no further SQL probes, the control plane reported suspension again at
06:34:32 UTC. The observed cycle was sleep → signed wake → scan → sleep.

## Remaining evidence and operating limits

The live authenticated **Render API mutation** has not yet been observed sending
its wake hint. The user was asked for one normal Garmin Sync; browser automation
is unavailable in this session. The deployed API code/config and direct signed
gateway route are verified, but they are not a substitute for that application
request. No provider request or recalculation was fabricated to bypass this gate.

Exact historical quota attribution and numerical before/after billed CU-hours
remain unavailable; the diagnosis uses the observed idle-query pattern, zero
runtime connections and actual compute suspension. Hourly recovery and real
traffic still incur active time. Frequent browser/API use or another old worker
can prevent suspension; do not promise zero cost or a full-month saving from
one controlled window.

The limited Cloudflare authorization intentionally excludes billing. The account
and scripts report usage model `standard`, which alone does not prove the plan.
No plan/payment write or paid resource was performed; do not relabel the old
Free-plan verification as a new billing-UI inspection. Numerical production
invocation CPU telemetry was not retrieved.

At the user's additional request, official Cloudflare skills and the Cloudflare
MCP server were installed globally and OAuth-authorized. MCP tool activation
requires restarting the agent; live setup in this session used the limited CLI/
documented script-upload API. No optional beta CLI or extra billing scope was added.

See [operation and rollback](../WORKER_WAKE.md), the [initial investigation](../WORKER_IDLE_COST.md)
and [issue #260](https://github.com/vokerg/sportos/issues/260). Keep the issue's
unperformed application/accounting checks explicit rather than inferring them
from a successful deploy or local test suite.

## Documentation review

Inspected for this activation record: `AGENTS.md`, `README.md`,
`docs/ARCHITECTURE.md`, `docs/WORKER_IDLE_COST.md`, `docs/WORKER_WAKE.md`,
`docs/GARMIN_WORKER.md`, `docs/gcp-worker-deployment.md`,
`docs/adr/0012-durable-garmin-worker-jobs.md`, and
`docs/implementation/issue-260.md`; also the deployed gateway, nginx template,
worker environment contract, private operations runbooks and protected live
configuration/evidence. Reviewed issue #260, merged PR #262 and its deployment.
Stale statements describing activation as pending or polling as the only deployed
mode were corrected. This follow-up changes documentation only; validation is
content/link/privacy review and `git diff --check`. Runtime test results remain
in the implementation record rather than being re-run for these edits.
