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

Validation: focused run-lap parser/chart, activity-detail store and existing swim
chart tests passed. Web typecheck, production build, architecture scan/regression
checks and diff whitespace checks passed. Browser validation on the requested
local page confirmed explicit loading of retained laps, synchronized pace
and heart-rate charts and the split table in the current dark theme. Garmin
parsing uses sanitized fixtures; this example has no linked Garmin counterpart.
No backend, schema, migration or scoring changes require database validation.
Private live source payloads/screenshots are not committed.

Additional activity-list polish: inspected
`apps/web/src/app/features/activities/activity-list.component.ts`,
`apps/web/src/app/features/activities/activity-list.component.test.ts`,
`apps/web/src/app/features/activities/activities-page.component.ts`,
`apps/web/src/app/features/activities/activity.view-model.ts`, and
`apps/web/src/app/shared/util/activity-subtype.ts`.
The compact row put Strava's activity name beside its type/subtype with no
visible delimiter, producing text such as `indoorMorning Swim`. Add a textual
middle-dot separator before the name; this changes presentation only and does
not alter source notes or canonical activity data. Row dividers and separators
remain static. No documentation mismatch was found.
