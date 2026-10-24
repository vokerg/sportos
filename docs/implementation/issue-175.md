# Running laps (#175)

Request: provide a swim-like running split view when retained laps exist.

Investigation inspected README.md, AGENTS.md, docs/ARCHITECTURE.md,
ROADMAP.md, AUTHENTICATION.md, AI_ANALYSIS.md, FRONTEND_ARCHITECTURE.md,
ACTIVITIES.md, adr/0010-garmin-activity-reconciliation.md; API activity swim parser
and enrichment service/controller; web Activities transport, detail page/store and
store tests, provider-detail view model, swim UI/chart models/tests, timeline UI,
running-effort UI tests, and web/API package scripts. Open issues/PRs, recent
merged swim PRs and current main were reviewed. No conflicting documentation
requirements were identified.

The existing retained Strava detail resource includes laps; Garmin's overview
includes up to 100 FIT lap messages. Reuse those owner-scoped reads with explicit
load actions and existing cancellation/repeated-click protection. The view exposes
source-specific distance, timer/moving or elapsed duration, derived pace and heart
rate. It does not infer equal-kilometre splits, download provider data, rewrite
canonical metrics or change scoring. Unverified Garmin completeness is explicit.
