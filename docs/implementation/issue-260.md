# Issue #260: worker idle compute and explicit wake

Documentation review [PR #261](https://github.com/vokerg/sportos/pull/261) is
squash merged. Runtime implementation is in [PR #262](https://github.com/vokerg/sportos/pull/262),
branched from current main `ced7179`. Issue #260 remains open for implementation
review and separately authorized production acceptance.

## Implemented scope

- A server/edge-only `@sportos/worker-wake` package supplies the fixed HMAC v1
  contract, key rotation/freshness validation and bounded stream handling.
- All current API job enqueue/retry/cancel paths notify after account-context
  completion. Disconnect notifies after its mutation, never after its credential
  read. Failed delivery preserves committed jobs and import source storage.
- `SPORTOS_WORKER_MODE=wake` uses a loopback listener, one coordinator, bounded
  fair rounds for every enabled queue, future deadline/startup/hourly recovery,
  bounded outage/unclaimable-row backoff and recreated/destroyed lazy pools.
  Existing active-job leases and account contexts remain authoritative.
- A separate fixed-route Cloudflare Worker and nginx location template provide
  the proposed gateway. They do not provision a hostname, TLS, network or account.
- Explicit API Garmin execution capability replaces heartbeat gating only when
  configured. Legacy behavior stays available. Mobile manual job checks remain
  usable while new execution is unavailable. No schema/grant changes are needed.
- Candidate claims use SQL `LIMIT 1`; dispatcher deadline discovery excludes
  disabled queues. GCP upload consumption and original retention are unchanged.

Configuration, protocol bounds, failure semantics, staged activation and rollback
are in [WORKER_WAKE.md](../WORKER_WAKE.md). The original diagnosis and inspected-file
inventory are in [WORKER_IDLE_COST.md](../WORKER_IDLE_COST.md). Additional actual
implementation reads include app/worker package and TypeScript project configs,
API module/startup and focused mutation tests, V143/V148 grants, the disposable
Garmin migration harness, worker entry tests and mobile provider-control tests.

## Validation evidence

Local checks use synthetic fixtures and no production services:

- API and worker TypeScript builds; mobile TypeScript check.
- Full API unit suite with `--no-file-parallelism`: 292 passed, five integration
  cases skipped without their dedicated environment. A prior parallel run hit
  existing MCP/Chat timeouts; the isolated MCP rerun and complete serial suite
  passed without changing those unrelated tests.
- Worker unit suite plus focused entry/coordinator/listener/pass tests: legacy
  and opt-in entry paths, loopback bind, cleanup on failure, missed/duplicate/
  deferred/late hints, fair rounds, delayed deadlines, shutdown, outage backoff,
  disabled consumers and all enabled queue handlers.
- Wake protocol package: four tests; gateway TypeScript check and three tests
  with fake origin fetch; rejects invalid signatures/configuration, private
  forwarding headers, raw-IP/redirect destinations, oversized/stalled bodies.
- Mobile provider/Garmin workflow tests: 17 passed, including checking a job with
  execution disabled. Existing React test renderer deprecation warnings remain.
- Disposable loopback PostgreSQL 16: fresh and populated primary/detail Flyway
  migrations and non-owner role tests passed (16 Garmin/Daily + three API cases).
  This includes expired-heartbeat configured enqueue, same-owner deduplication,
  cross-owner denial, retained evidence and unchanged official records.
- Two additional real worker passes on that isolated cluster released every
  dispatcher/worker-data connection. All five deadline queries ran using the
  dispatcher role. The same smoke is added to the existing CI harness.
- GCP deployment/release-scope tests: 21 passed, eight platform-gated skips.
  Linux release packaging remains a CI gate; the initial implementation commit's
  package check passed. Latest-head CI results are reported in the PR.

The temporary database is distinct from Neon; no provider request, production
migration, credential read, Cloudflare deployment or GCP service change was made.
The PostgreSQL 18 disposable CI gate remains important alongside local PG16.

## Remaining acceptance

No live Render -> deployed Worker -> verified DNS/TLS -> GCP IPv6 path was tested.
Origin selection/renewal, actual Free-plan signature CPU consumption, authorized
staged enablement, all worker-instance inventory, controlled Neon suspension and
before/after CU-hour measurement remain unperformed. Current deployments retain
their existing polling cost until explicitly switched. Do not mark #260 complete
or infer rollout authorization from code checks.
