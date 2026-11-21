# SportOS API on Cloudflare Workers Free

Issue [#270](https://github.com/vokerg/sportos/issues/270), measured 2026-11-21.
**Decision: retain Render for the API.** NestJS/Express can boot on Workers,
and local Angular can reach it through a same-origin proxy. The existing
password verifier consumed **141–228 ms of Worker CPU per attempt**, before
any session or database work. Workers Free budgets **10 ms per request**.
The temporary deployment returned HTTP 200, consistent with a runtime that
can allow requests to run past that budget. Five attempts all exceeded the
published limit, so the successful responses do not establish reliable Free
operation. [Cloudflare CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)

The trial used two short-lived Workers in an unclaimed temporary account,
with synthetic inputs and inert database URLs. Production Render, Vercel,
Neon, the Cloudflare wake gateway, and GCP were outside the deployment target.
No production credentials, provider settings, callback URLs, DNS, databases,
or billing settings were changed.

## Reproduce

Run from the repository root. Build the API first to preserve the TypeScript
decorator metadata that Nest relies on. The trial bundles the built API for
Node with esbuild. Wrangler's default bundling first failed to resolve unused
Nest integrations and the CommonJS XLSX entry point. With those resolved,
it selected browser mappings for `iconv-lite` and failed during Express
startup. The Node-targeted bundle resolves XLSX and keeps `iconv-lite`'s
stream support. The trial excludes optional Nest integrations and the unused
native Postgres driver from bundling.

```sh
pnpm install --frozen-lockfile
pnpm --filter @sportos/api build
node docs/experiments/workers-api/build.mjs
pnpm dlx wrangler@4.165.0 dev --config docs/experiments/workers-api/wrangler.jsonc --port 8791
```

With the API built, run these separately from `docs/experiments/workers-api`
for an expiring Cloudflare deployment without account sign-in. Use the Worker
URLs printed by Wrangler. The claim URL is a credential and must stay private.
Cloudflare makes these probes publicly reachable and gives an unclaimed
deployment a 60-minute claim window. Leave it unclaimed for a disposable run.
If deploying to an authenticated account instead, check the plan and script
names first. [Cloudflare temporary deployments](https://developers.cloudflare.com/workers/platform/claim-deployments/)

```sh
pnpm dlx wrangler@4.165.0 deploy --config wrangler.jsonc --temporary
pnpm dlx wrangler@4.165.0 deploy --config wrangler.scrypt.jsonc --temporary

curl -i "$API_TRIAL_URL/health"
curl -i "$API_TRIAL_URL/auth/config"
curl -i "$API_TRIAL_URL/auth/session"
curl -i -X POST "$SCRYPT_TRIAL_URL/verify"
```

The API probe only serves anonymous GETs for those three routes. It drops all
incoming cookies and authorization headers. The password probe always uses a
fixed synthetic test vector with the actual SportOS verifier and never issues a
session. Keep both probes free of real credentials and databases. To measure
edge CPU, capture invocation `cpuTime` in Workers Logs or authenticated
`wrangler tail --format=json`. Avoid recording request headers, client
identifiers or claim tokens in the experiment results.
[Cloudflare invocation logs and CPU measurement](https://developers.cloudflare.com/workers/platform/limits/#monitoring-cpu-usage)

## Run local Angular against either origin

From the root, set `SPORTOS_TRIAL_API_ORIGIN` to the Worker origin or to the
existing Render origin in the [deployment guide](../../DEPLOYMENT.md).
Restart this loopback-only dev server to switch targets. Use a disposable
browser profile for the experiment. The local TLS certificate is self-signed.

```sh
SPORTOS_TRIAL_API_ORIGIN=https://<api-host> pnpm --filter @sportos/web exec ng serve \
  --host localhost --port 4211 --ssl --build-target web:build:hosted \
  --proxy-config ../../docs/experiments/workers-api/proxy.cjs
```

Open `https://localhost:4211/`. The proxy removes the `/api` URL prefix and
preserves the browser's Origin header. Render checks that Origin against its
configured production web origin at password login, so the local Render
baseline stops at sign-in. Test the anonymous flow without entering production
credentials. In headless Chrome, the Angular sign-in form rendered against
each upstream, and companion localhost proxy requests received the expected
responses. The Cloudflare run used a second loopback port, 4212, for same-origin
proxy testing. Its direct CORS test used the configured origin
`https://localhost:4211`.

Stop the Angular and Wrangler dev servers to end the local trial. Standard
`pnpm dev:web` restores the usual local-development path. The temporary Workers
expire without claiming the account. Production routing needs no rollback.

## Validation

| Check | Render via local Angular proxy | Cloudflare trial via local Angular proxy |
| --- | --- | --- |
| Angular sign-in page, health, auth configuration | Passed in headless Chrome and HTTP checks | Passed in headless Chrome and HTTP checks |
| Anonymous session | HTTP 401 | HTTP 401 from the Nest session guard |
| Foreign password Origin | HTTP 403 from Render | Password route gated with HTTP 404. Direct CORS response advertises only the configured origin, even when sent a different Origin. |
| Actual password verifier | Unit test passed on Node. Hosted login untested. | Correct synthetic password verified, but exceeds Free CPU budget. |
| Secure cookie forwarding, session persistence, logout, live CSRF rejection | Untested. Local Origin blocks login. | Untested. Probe never issues sessions. |
| Overview, Daily, Activities and detail, Monthly Stats, Dynamics, rules, provider status | Authenticated UI untested | Authenticated UI untested |
| Canonical export, bounded analysis and chat | Untested | Untested |
| Staging primary and activity-detail Neon, non-owner roles, cross-account negative cases | Untested | Untested. Staging was deferred after the Free CPU result. |
| Queue enqueue and wake, uploads and durable storage, Strava/Garmin, mobile and MCP streaming | Untested | Gated outside the probe. No jobs, data or provider credentials used. |

The API TypeScript build passed. The existing focused CORS, single-user auth,
and session-guard suites passed all 18 tests, including the missing-CSRF case.
This verifies existing application logic in tests, independently of HTTP
cookies and CSRF in the deployed Worker.

### Performance and cost

Health measurements used eight sequential HTTPS requests per deployment from
the same Mac. The first request was included, but actual Render or Worker
idle state was not controlled. p50 uses the sample median and p95 uses nearest
rank. These samples are too small to characterize tail latency.

| Measurement | Result |
| --- | --- |
| Render direct health wall time, n=8 | p50 117 ms, p95 280 ms, 8/8 HTTP 200 |
| Worker direct health wall time, n=8 | p50 129 ms, p95 579 ms, 8/8 HTTP 200 |
| Worker CPU for health / auth config / anonymous session | 1–2 ms / 0–1 ms / 0–1 ms, four traced requests per route |
| Worker startup and upload | 361 ms startup, 7,457 KiB uncompressed, 1,489 KiB gzip |
| Worker CPU for one existing password verification, n=5 | 141, 145, 186, 197, 228 ms. p50 186 ms, p95 228 ms. All five traces returned HTTP 200. |
| Password RAM on local Node 26, one process per case | Peak RSS 41.3 MiB on import only and 107.6 MiB with one verification, a 66.4 MiB difference. Worker isolate peak and concurrent memory were unmeasured. |

There were no confirmed idle requests, authenticated route timings, Neon
wake timings, or sustained traffic measurements. Workers Free allows 100,000
requests per day per account, which a permanent trial would share with the
wake gateway. At an illustrative 20 API requests per visit and 10 visits per
day, the API would add about 200 requests daily before polling, retries,
mobile and background calls. That estimate is not a production usage
measurement. Workers allow 128 MB per isolate and a 64 MiB uncompressed upload.
[Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

Render Free has a 15-minute idle window and can take about a minute to wake.
Render Starter starts at $7/month and stays running. Workers Paid starts at
$5/month and raises the CPU allowance enough to cover the observed verifier,
while retaining the same isolate memory limit and introducing usage charges
above included allowances. Given the measured Free blocker, a paid Workers
trial would still need database, rate-limit, memory and application parity
work. Render Starter addresses the Render sleep behavior without migrating
the API runtime. [Render Free](https://render.com/docs/free) ·
[Render pricing](https://render.com/pricing) ·
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## What a migration would require

A subsequent trial needs an approved authentication architecture that meets
the CPU budget, plus shared rate-limit enforcement across isolates. The current
in-process password, mobile, OAuth and chat throttles do not form a shared
limit. Production scrypt parameters should stay intact unless authentication
itself is redesigned and reviewed.

Use separate disposable primary and activity-detail Neon databases with
synthetic records and non-owner runtime roles. Test request-owned database
connections and both projects' forced RLS with successful owner reads,
cross-owner rejection, same-connection transactions and connection cleanup.
The current account context sets a session-scoped GUC before repository
queries. Hyperdrive and Neon pooled endpoints use transaction pooling, so
a stock pool swap can discard that setting between statements. First test
direct Neon with request-owned connections, or explicitly redesign account
context and repository transactions for transaction-scoped state. Disable
SQL result caching for session and owner-scoped queries. Preserve the
separate worker-owned job and wake boundaries.
[Hyperdrive pooling semantics](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/#connection-pooling) ·
[Neon connection pooling](https://neon.com/docs/connect/connection-pooling)

An indicative engineering estimate is several days for a staged database,
auth and read-route trial once an authentication design is approved, with
additional work for distributed limits, provider/OIDC callbacks, durable
uploads, queue and wake validation, mobile and MCP streaming. The two
diagnostic Workers do not establish the cost or schedule of a production
migration.

## Authenticated staging follow-up

After Google-only sign-in went live on Render, the staging target was added
for the same Nest application. Its Postgres pools belong to the request, and
it uses the existing session guard, CSRF checks, owner-scoped repositories and
Google token verification. It gates imports, provider mutations, job writes,
AI, mobile approval and MCP streaming. The wake gateway has its own deployment.

### Runtime setup

Use a separate staging frontend origin with a same-origin `/api` proxy. On
loopback, the Angular command above can point to `http://127.0.0.1:8791`.
For hosted staging, the proxy points to the separate staging Worker origin.
Register the exact `<staging-web-origin>/api/auth/callback` in a separate Google
Web OAuth client. Allow only the staging owner's verified Google subject in
the staging database. Use empty Neon projects with synthetic data and separate
primary and activity-detail credentials. Copy neither production DB URLs nor
production provider, wake or OAuth secrets.

Use `sportos_app` login roles with direct connections. Check both roles have
`NOBYPASSRLS` and own no application tables. Use `sslmode=verify-full` for
remote databases. Migrate the primary database from `flyway/sql` and the
detail database from `flyway/activity-detail-sql`. Detail migration V001
grants access on the fixed name `sportos_activity_detail`. Use that name for
the fresh detail migration, then rename the staging database to
`sportos_trial_detail` before connecting the Worker. The staging primary
database name is `sportos_trial_primary`.

Supply these values through Worker runtime secrets or an untracked,
permission-restricted file for `wrangler dev --env-file`:

- `SPORTOS_STAGING_DATABASE_URL` and `SPORTOS_STAGING_ACTIVITY_DETAIL_DATABASE_URL`
- `SPORTOS_WEB_ORIGIN` and `SPORTOS_API_ORIGIN` (the staging web origin and its `/api` URL)
- `SPORTOS_OIDC_CLIENT_ID` and `SPORTOS_OIDC_CLIENT_SECRET` for staging

```sh
pnpm --filter @sportos/api build
node docs/experiments/workers-api/build.mjs --staging
pnpm dlx wrangler@4.165.0 dev \
  --config docs/experiments/workers-api/wrangler.staging.jsonc \
  --env-file /path/to/private/trial.env --port 8791
```

Use the separately configured `sportos-api-staging` target for deployment.
The first upload must include the runtime settings. Later deployments use
`keep_vars` to preserve the configured runtime variables. A dry run validates
the bundle only. Use the `workerd` package condition when bundling so
node-postgres loads its Workers socket implementation.

### Deployment from main

The [Cloudflare API staging workflow](../../../.github/workflows/cloudflare-api-staging.yml)
builds and deploys this target on relevant pushes to `main`, or on a manual
dispatch from `main`. It is opt-in. After the first successful staging
deployment, set the repository variable
`SPORTOS_CLOUDFLARE_STAGING_ENABLED=true`. Create the GitHub environment
`cloudflare-staging` with a Cloudflare Workers deployment token in
`CLOUDFLARE_API_TOKEN` and the non-secret variables `CLOUDFLARE_ACCOUNT_ID`
and `STAGING_API_ORIGIN`. Keep runtime credentials in Cloudflare. The
workflow checks health, authentication mode and anonymous authorization
after each deployment. Set the repository variable to `false` to pause
deployments. The workflow does not change the Vercel API destination.
[Cloudflare deployment reference](https://developers.cloudflare.com/workers/ci-cd/builds/)

### Verification

On local workerd with two freshly migrated, disposable PostgreSQL databases,
using `sportos_app` and synthetic rows and sessions:

| Check | Local result |
| --- | --- |
| Google authorization start | 302 to Google with a Secure state cookie |
| Session and canonical activity | Owner session and activity detail returned 200 |
| Owner isolation | Another owner's canonical activity returned 404 |
| Daily, Dynamics, rules, provider status, heatmap and export | 200 with valid route parameters |
| Logout | 403 without CSRF, valid logout succeeded, prior session then returned 401 |
| Password | Unavailable on the staging target |

Live Google callback, hosted Neon connectivity, Cloudflare Free CPU timings
for these authenticated routes, and automated remote deployment remain
separate gates. Local fixture sessions exercise authorization and queries
without a production account or production OAuth client.
