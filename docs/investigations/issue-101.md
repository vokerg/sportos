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
