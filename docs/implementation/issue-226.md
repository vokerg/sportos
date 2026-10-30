# Issue 226: Durable Garmin worker execution

Issue: <https://github.com/vokerg/sportos/issues/226>
PR: <https://github.com/vokerg/sportos/pull/227>
Status: Implemented and locally/live validated; review and hosted rollout pending.

## Scope and outcome

Day and activity Fetch/Refresh submit durable jobs rather than running Garmin in
the API. A separate worker process claims work through Postgres and uses encrypted
owner-bound SDK sessions. Both web and native support progress, bounded polling,
manual status continuation, cancellation and retry. Reopening discovers active
work. Explicit recalculation continues to use retained primary projections only.

Repeated requests for the same day are supported: identical active submissions
return one job, and another refresh after completion starts new work. Immutable
retention converges on identical evidence. No archive import, automatic scoring,
public multi-user Garmin onboarding or Oracle worker enablement is included.

## Investigation

Current main, open issues/PRs, recent merges and claim state were checked before
claiming #226. The previous native parity work #225 was already merged. The issue
claim records the initial inspected files. Additional execution and validation
inspection covered all primary/detail migration files and these entry points:

- `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`,
  `docs/AUTHENTICATION.md`, `docs/AI_ANALYSIS.md`, `docs/FRONTEND_ARCHITECTURE.md`,
  `docs/GARMIN_DAY_FETCH.md`, `docs/GARMIN_SINGLE_ACTIVITY.md`, ADRs 0002, 0003,
  0005, 0006, 0010 and 0011.
- `apps/api/src/app.module.ts`, `db.provider.ts`, activity enrichment,
  local-ingest, route projection and running-effort services/controllers/tests;
  daily Garmin service, controller, projections and tests.
- `apps/worker/src/import-worker.ts`, `provider-sync-runner.ts`,
  `polling-loop.ts`, package/TypeScript configuration.
- `packages/db/src/schema.ts`, `pool.ts`, `ownership-context.ts`, index and
  Garmin schemas; provider/worker-dispatch/Garmin activities/day/resources,
  activity metrics and running-effort repositories and closest integration tests.
- `packages/importers/src/credential-cipher.ts`, provider types, storage and
  exports; `tools/garmin/activity_bridge.py`, `extract_activity.py`, `fetch_day.py`,
  requirements and tests; installed pinned SDK session import/export implementation.
- Web Garmin day transport/models/store/card/tests, activity transport/store/page/
  tests, and `core/jobs/durable-job-poller.ts`.
- Native provider model, Garmin day hook/card, day actions, activity screens,
  session/API infrastructure and closest tests; mobile README/package configuration.
- `.env.example`, root package/workspace/TypeScript configuration,
  `.github/workflows/ci.yml`, `Dockerfile`, hosted startup and its tests,
  `scripts/flyway.mjs`, `scripts/garmin-local.mjs`, Docker worker environment example.

The key mismatch was API-local execution plus worker denial of Garmin detail/day
resources. Simply removing the local-only guard would not provide hosted parity.
The implementation extracts shared server execution, adds narrow worker grants,
imports only bounded encrypted session fields, and preserves provider invariants.
The separate detail database also revoked PUBLIC CONNECT: table grants alone were
insufficient. V006 and a regression gate with the actual detail database name
cover this deployment condition.

## Validation

- Root `pnpm test`, `pnpm typecheck` and `pnpm build` passed. Default test skips
  remain for suites requiring explicitly supplied database environments.
- Focused API queue, runtime extraction, web lifecycle/component, native lifecycle,
  cipher and offline Python helper tests passed. Web architecture guard passed.
- Dedicated disposable Postgres gate passed fresh and populated upgrades for both
  databases, retained fixture checks, private CONNECT grants and six non-owner
  integration cases. These cover repeat convergence/session rotation, API and
  dispatcher isolation, cross-owner identifiers, stale lease/cancellation fencing,
  envelope/target constraints, graceful interruption and durable rate-limit waits.
  CI has an independent Postgres service job for this gate without private secrets.
- Real primary V143/V144 and detail V005/V006 were applied and validated. A
  dedicated non-owner detail worker login was provisioned privately. A protected
  existing SDK session was imported into the encrypted credential table.
- Live HTTP requests through the local API and a separate worker process using
  the shared databases completed two successive explicit refreshes for one
  completed day. Concurrent identical submission returned the same active job.
  A subsequent repeat after fencing changes also passed. Before/after fingerprints
  and counts of canonical activities, daily metrics, ledger and snapshots were
  identical. Personal dates, category values, credentials and provider payloads
  are excluded from this report and version control.
- iOS Hermes production export passed. Native/web automated coverage includes
  queued/running/terminal handling, bounded polling and explicit continuation.

## Rollout and limitations

The live check proves API/worker process separation through Postgres on the local
workstation; it is not evidence of a deployed hosted release or a cross-host
network test. Hosted API and the installed phone still use the previous release.
They require the new API/client versions and configured worker to expose this flow.
A synthetic native preview exported successfully, but visual interaction could not
be checked because computer-use could not find a Simulator window. The worker
Docker stage now installs the pinned Python environment, but Docker
image build/run was not verified because no Docker daemon was available.

Session bootstrap remains a trusted legacy-account operator action. Reconnect
requires a fresh interactive login/import; the old desktop token file does not
track worker session rotations. Worker original-byte storage must persist across
restarts/moves. The #95 Oracle shared-storage hold remains unchanged. The PR is
unmerged pending explicit authorization under `AGENTS.md`.

See [operations](../GARMIN_WORKER.md) and [ADR 0012](../adr/0012-durable-garmin-worker-jobs.md).
