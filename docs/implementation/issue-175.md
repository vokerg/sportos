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

Daily trend readability and score-composition review: inspected
`apps/web/src/app/daily-log.view-model.ts`,
`apps/web/src/app/daily-log.view-model.test.ts`,
`apps/web/src/app/daily-log-trend.component.ts`,
`apps/web/src/app/daily-log.component.ts`,
`apps/web/src/app/features/daily/state/daily-log.store.ts`,
`apps/web/src/app/features/daily/data-access/daily-api.service.ts`,
`apps/web/src/app/features/daily/model/daily.models.ts`,
`apps/web/src/app/rolling-dynamics.view-model.ts`,
`apps/web/src/app/features/dynamics/model/dynamics.models.ts`,
`apps/api/src/daily/daily.service.ts`,
`apps/api/src/dynamics/dynamics.contracts.ts`,
`apps/api/src/dynamics/dynamics.contracts.test.ts`,
`packages/db/src/repositories/dynamics.repository.ts`,
`packages/db/src/repositories/dynamics.repository.test.ts`,
`packages/db/src/repositories/cockpit.repository.ts`, and migrations V112/V118
that define `v_daily_summary`.

The Daily Log and Dynamics average plots use different scales: the Daily Log
shares its axis with daily totals up to about 70,000, while Dynamics shows the
average on a 0–40,000 scale. Their calculations also differ when dates are
missing: Daily Log's stored `avg_30d` averages the last 30 persisted rows;
Dynamics averages across 30 calendar dates. Preserve those existing values,
use one shared points axis for bars and average, and increase chart height
slightly. Stack the official score-ledger contributions in each daily bar and
place unsupported or unreconciled points in an `Unattributed` segment so the
components sum to the official daily total. This is presentation-only; no score,
source, or stored daily average data changes.

Implementation review: the Daily Summary now returns owner-scoped ledger totals
per date. Unsupported activity types and imported rows that cannot be decomposed
remain visible as `Unattributed`; any difference from the official total is
added to that segment. The chart stacks only nonzero components, uses one shared points scale for
bars and the average, is slightly taller, and has animation disabled. The
initial separate average axis made the average appear above larger daily
totals, so it was removed after visual feedback, along with the redundant
line connecting bar tops. The contribution category contract also carries
`Unattributed` through Dynamics. Existing average values and date-window rules
are unchanged.

Validation for this follow-up: web, API, database and shared-package typechecks,
the web production build, and `git diff --check` passed. Focused Vitest tests and
live browser verification were not run for this follow-up.

Shared-axis correction: re-inspected the Daily Log chart view model, its tests,
trend component, page help and this implementation note. Bars and the sole
average line now share axis 0; the total-points connector series is removed.
The average has an explicit contrasting color. Existing chart tests check that
there is one points axis and exactly one line series.
Validation for the shared-axis correction: all six Daily Log view-model tests,
web typecheck, production build and whitespace checks passed. Live browser
verification was not run.
