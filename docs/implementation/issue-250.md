# Calculate all with a completed-day scoring cursor (#250)

PR #251 starts from current main `6ea4b66`. The issue claim records investigation
before editing. No pre-existing open PR owned this scope. The provider acquisition
cursor cannot serve as a scoring checkpoint: fetching remains evidence-only,
while scoring has an explicit independent action and must keep today provisional.

## Behaviour

Web Overview and native Home expose Calculate all, status/progress, cancellation,
retry and bounded manual continuation. Server-derived dates run from the first
pending scoring date through the fixed current-day endpoint. Each claim invokes
the existing authoritative retained-data daily scorer. Score, ledger, append-only
snapshot, job progress and any past-day cursor advance commit in one fenced
owner-scoped transaction. No rules or point formulas change, and no provider
request, Python helper or separate detail-database query is added to scoring.

Only contiguous successfully calculated past calendar days become completed.
Today receives an updated score on every separately completed request but never
advances completed-through. Concurrent requests deduplicate. A job crossing
midnight keeps its original end date; its previously provisional final day may
then become completed, and the next run includes the new day. The persisted IANA
calendar defines the day independently of browser/host time zones and DST length.

Missing evidence stops without inventing a zero score or skipping the date.
Failures/cancellation preserve earlier checkpoints. Retry derives a new bounded
window from current progress. Expired claims recover with a three-attempt bound;
old workers and aborted operations cannot commit replacement scores/checkpoints.

V148 adds separate cursor/job tables, forced RLS, immutable ownership and targets,
same-owner/calendar foreign keys, contiguous past-day cursor enforcement,
column-specific API/dispatcher/worker-data grants and privilege assertions.
Existing canonical tables retain their existing forced-RLS dispatcher exclusions.
Public status excludes owners, leases, source details and storage metadata.

## Validation

- Full `pnpm typecheck` and `pnpm test` pass. The normal test command skips
  database-dependent suites by design; they are exercised separately below.
- Web production build and Angular architecture guardrails pass.
- Focused API contract tests cover session-derived ownership, empty-body-only
  mutation contracts, UUID validation and generic foreign/missing responses.
- Web/native workflows cover ten repeat runs today, duplicate protection, active
  recovery, ambiguous submissions, partial-success refresh, cancellation/retry,
  bounded polling and teardown. Native uses allowlisted transport projections.
- Disposable loopback Postgres fresh/populated migration gates pass for both
  databases, preserving prior retained evidence. Six new worker integration
  scenarios pass using non-owner API, dispatcher and worker-data roles, alongside
  the nine existing Garmin worker scenarios and three API retention/native JSON
  scenarios. They prove real score history, checkpointing, changing same-day
  evidence across ten repeats, missing-day retry, score-write rollback, lease
  recovery, midnight/calendar handling and ownership/role exclusions.
- On an expiring temporary copy of production, direct-connection Flyway V148 and
  the maintained-account operator seed command pass. A retained-only calculation
  from the requested 4 November seed through today completed all ten days;
  completed-through remained yesterday and the next pending day remained today.
  Only the temporary copy's scores changed. No private scores, source content,
  provider payloads, credentials, deployment inventory or screenshots are recorded.

Browser rendering through the authenticated hosted session and physical native
device interaction have not been verified in this task. Computer-use access was
unavailable. The Angular build and native component/contract tests passed.

## Rollout

This report describes prepared implementation, not a live deployment. Apply V148
before activating the API and worker revisions. Initialize the maintained account
with `pnpm daily:calculation-seed -- 2026-11-04 Europe/Copenhagen` before its first
Calculate all request. Initialization changes no scores and refuses to replace an
existing cursor. The operator command is account-fixed and uses the non-owner
worker-data login; no account identity or deployment secret is committed.

Repository instructions require explicit authorization before squash-merging.
After merge/deployment, verify status and an explicit run, then update #250 with
the actual rollout evidence. No production V148, seed, score recalculation or
deployment has been performed for this feature at this checkpoint.

## Inspected files

- `AGENTS.md`, `README.md`, `package.json`, `.github/workflows/ci.yml`,
  `.github/workflows/gcp-worker-deploy.yml`.
- `docs/ARCHITECTURE.md`, `ROADMAP.md`, `AUTHENTICATION.md`, `AI_ANALYSIS.md`,
  `FRONTEND_ARCHITECTURE.md`, `SCORING_RULES.md`, `GARMIN_WORKER.md`,
  `implementation/issue-248.md`, `adr/0012-durable-garmin-worker-jobs.md`.
- `flyway/sql/` migration inventory and DDL/grant definitions, especially V105.1,
  V106, V108, V112, V119, V126, V143, V144, V146, V147, then new V148.
- `packages/db/package.json`, `tsconfig.json`, `src/schema.ts`, `index.ts`,
  `pool.ts`, `ownership-context.ts`, `garmin-jobs-schema.ts`,
  `daily-recalculation-schema.ts`, `repositories/daily.repository.ts`,
  `daily-scoring.repository.ts`, `daily-scoring.repository.integration.test.ts`,
  `garmin-jobs.repository.ts`, `rule-changes.repository.ts`,
  `daily-recalculation.repository.ts`.
- `apps/api/src/app.module.ts`, `db.provider.ts`, `auth/auth.controller.ts`,
  `daily/daily.controller.ts`, `daily.service.ts`, `garmin-day.integration.test.ts`,
  `daily-recalculation.controller.ts` and its test.
- `apps/worker/package.json`, `tsconfig.json`, `src/import-worker.ts` and its test,
  `rule-change-runner.ts`, `garmin-job-runner.ts` and its integration test,
  `daily-recalculation-runner.ts` and its integration test.
- `apps/web/src/app/overview-page.component.ts`,
  `core/jobs/durable-job-poller.ts`, provider Garmin sync API/store/UI and tests;
  Daily calculation model, API client, store and tests, UI and public index.
- `apps/mobile/src/daily/screens.tsx`, `CalculateAllCard.tsx`,
  `calculation-model.ts`, `providers/GarminSyncCard.tsx`, `use-operation.ts`,
  `track-garmin-job.ts`, `test/provider-controls.test.tsx`,
  `daily-navigation.test.tsx`, `calculate-all.test.tsx`.
- `scripts/test-garmin-worker-db.mjs`, `daily-calculation-seed.mjs`.

Documentation mismatch resolved: per-day recalculation documentation did not
describe a durable scoring cursor or bulk action. The existing Garmin acquisition
cursor's inclusive same-day semantics remain unchanged; the new documentation
explicitly distinguishes acquisition from completed-day scoring.
