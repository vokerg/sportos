# Overview Update everything (#268)

The prominent **Update everything** action replaces three separate Overview/Home
controls in responsive Angular web and native mobile. An explicit click runs the
existing Strava import, Garmin general sync and Daily calculation, in that order.
Only successful terminal status advances the chain. Provider readiness errors,
failed/cancelled jobs and uncertain requests stop progression and show safe copy.
Opening either screen never enqueues work.

The shared client workflow owns ordering, duplicate-click protection and a
screen-memory checkpoint. Angular uses a route-scoped feature store, a dedicated
transport adapter and the core durable-job poller (240 reads / ten minutes per
wait). Native uses the existing abortable operation scope (24 reads / two minutes
per wait). **Continue update** resumes the same paused job. Navigation cancels
client observation, not queued server work; keep Overview/Home open for automatic
stage progression, or return and click again. This is not a new server-side
background pipeline. No workflow checkpoint or private data is written to device
storage. If a screen is recreated, another explicit run recovers active jobs and
repeats cursor-based stages safely.

Existing account/session/CSRF, queue uniqueness, leases, encrypted credentials,
provider-native identities and deterministic scoring remain unchanged. Targeted
provider work is awaited before starting general sync. A calculation that was
already active is awaited before requesting calculation of newly retained data.
The existing Calculate all cursor semantics apply: pending calendar days through
today, with today provisional and recalculated on subsequent runs. It does not
rewind the scoring cursor or recalculate all historical days. Neither provider
sync alone gains authority to write official scores. No migration, deployment,
archive import, new provider access or infrastructure change is required.

## Investigation

Inspected current main `8582ba6`, open issue bodies and PRs #265/#267, and recent
merges #252/#255/#257/#259/#261–#263. No duplicate claim or combined-action issue
was found. #265/#267 modify other responsive routes. Strava active enqueue returns
409, whereas Garmin and calculation deduplicate active enqueue. The workflow
therefore checks active work first; an uncertain Strava POST is reconciled against
the latest job before resubmission. Cross-client races may require Continue update;
the existing server uniqueness constraints prevent simultaneous duplicate work.

Files inspected before implementation: `AGENTS.md`, `README.md`,
`docs/{ARCHITECTURE,ROADMAP,AUTHENTICATION,AI_ANALYSIS,FRONTEND_ARCHITECTURE}.md`,
ADRs 0006/0008/0012; web `overview-page.component{,.test}.ts`,
`core/jobs/durable-job-poller.ts`, provider store/models, Garmin sync and Daily
calculation API clients; mobile `README.md`, `package.json`, `vitest.config.ts`,
Daily screens/calculation card/model, Garmin sync card/job models, operation scope,
provider model and calculation tests; API provider controller/service, Garmin jobs
controller/service and Daily recalculation controller; DB provider and Daily
recalculation repositories; shared package/TypeScript configuration and root
`tsconfig.base.json`. Additional implementation inspection: web architecture guard,
Daily calculation UI tests and mobile UI primitives.

Documentation mismatch: the mobile guide still described heartbeat readiness in
wake deployments. The updated description follows API-reported readiness.

## Validation

Focused workflow and client checks are recorded in the PR. No live provider
requests or production score writes are part of local verification.
