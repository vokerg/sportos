# Issue 101 investigation

Maintainer explicitly activates source fetch/display controls, overriding the
previous automatic rich-Strava fetch on detail-page navigation. Full archive #98
remains deferred. Branch created from current main and fast-forwarded to #104;
this PR stacks on #104 and owns the #101 UI/API work.

Before implementation inspected: issue #3/#101 and open PRs #103/#104;
README.md, docs/ARCHITECTURE.md, docs/ROADMAP.md, docs/AUTHENTICATION.md,
docs/AI_ANALYSIS.md, docs/FRONTEND_ARCHITECTURE.md, docs/ACTIVITIES.md,
ADR 0010 and docs/GARMIN_SINGLE_ACTIVITY.md; activities feature page/client/view
models/tests; activities controller/provider-detail service/tests; primary/detail
DB providers and activity/provider/Garmin repositories; local extractor/transport,
local ingest controller; AppModule and authentication/session guards.

Documentation mismatch: #101 and ACTIVITIES.md preserve automatic rich-Strava
fetch when visiting detail. The maintainer now requires explicit fetch buttons
for both providers. Reads/status/disclosures must never initiate provider calls.
Garmin local tokens are workstation-only, never a shared hosted credential.
Scoring/canonical authority, account context, CSRF, bounds and ambiguity policy
remain unchanged. Display source-specific retained facts independently.

Implemented: explicit Strava cached GET versus authenticated POST Fetch/Refresh;
metadata-only activity availability; owner-scoped bounded Garmin session/lap/set
and individual-resource reads; explicit workstation Garmin bridge with current
cache reuse, conservative bounded compact discovery and targeted extraction.
The bridge is disabled in production/other accounts, has no password UI, inherits
no API/schema credentials, and has fixed operations/deadline/concurrency bounds.
Existing local-ingest validation moved into a reusable retention service. Raw
source hashes/manifest keys remain private. New Angular route-scoped state owns
cancellation and separate read/fetch states; no provider fetch occurs on navigation.

Additional inspected files: worker startup/config (previous follow-up), importer
upload storage, pinned SDK activity-list implementation, package manifests/lock,
local ingest tests, account resource integration tests, app auth config/main,
feature page tests. No schema migration or new database role is introduced.

Validation: focused API tests, feature page/store tests, parser/discovery tests,
non-owner detail resource reads with cross-owner negative evidence and isolated
synthetic HTTP staging/view/cache-hit pipeline passed. Root frozen install,
typecheck/tests/build passed; unconfigured unrelated integrations skipped.
Browser visual inspection was denied by automatic browser approval; no alternate
browser/headless workaround was attempted. No personal activity identifier,
payload, credentials, location or telemetry is committed. Full list badge rollout,
full archive #98, incremental jobs and richer charts remain outside this targeted
activity-page phase. Neither dependencies nor #101 are merged/closed.

Pre-merge documentation audit inspected README.md, AGENTS.md,
docs/ARCHITECTURE.md, ROADMAP.md, AUTHENTICATION.md, AI_ANALYSIS.md,
ACTIVITIES.md, GARMIN_SINGLE_ACTIVITY.md, ADR 0010, .env.example,
all three investigation records, issue #3/#97/#99/#101, PR bodies and checks.
The audit updates current behavior/setup/limitations while preserving dated
investigation evidence; merges are maintainer-authorized and use squash order
#103 -> #104 -> #105 with dependent commits rebased onto each new main head.

Current integration status (2026-10-07): the investigation above records its
original phase and validation, not a claim that later work is still blocked.
The maintainer authorized merging the three delivery PRs. Current setup,
implemented behavior and remaining scope are maintained in ACTIVITIES.md,
GARMIN_SINGLE_ACTIVITY.md, AUTHENTICATION.md and ROADMAP.md. #97 is the completed
foundation; #99 incremental synchronization and #101 list-wide coverage remain
open follow-ups. Single-activity live retention/linking passed; browser visual
verification remains outstanding after permission was declined.
