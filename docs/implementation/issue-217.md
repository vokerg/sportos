# Issue 217 — mobile provider controls

Maintainer requests Strava Sync changes and Garmin refresh on the separate day
screen, assuming an available worker. No automatic provider action on navigation.

Inspected: native auth transport/session/cancellation, AppNavigation/routes,
More/Daily screens and models; API providers controller/service, Garmin day
controller/service; web provider contracts/data access and Garmin day contracts/
store. Current main and open PRs reviewed. #216 remains a separate day-navigation
fix, to be integrated for the phone build without merging it without permission.

Deployment mismatch: Garmin fetchEnabled belongs to the API's local Garmin
helper, not the queue worker. This change respects that capability; it does not
expose local credentials or enable a hosted helper. Strava sync uses existing
native bearer-authorized endpoints and the persisted account-scoped worker job.

More > Providers reads existing Strava connections, submits incremental sync,
shows bounded progress/status, supports retry/cancel and manual status refresh.
Polling stops after 24 five-second checks, on blur, teardown or transport error.
Jobs continue on the server after polling stops. Mutation timeouts require status
refresh before another sync submission. Raw errors, provider payloads, scopes,
account internals and job result JSON are excluded from native view models.

Day detail reads compact retained Garmin categories independently from the
score. Explicit Fetch missing / Refresh actions honor fetchEnabled. Category
partial failures and preserved prior evidence remain visible. No raw resources
are loaded and no score recalculation is triggered. Native request deadlines
and route cancellation remain in effect; a timeout may precede a long helper run.

Validation: mobile typecheck and all 62 tests passed (40 models plus 22 runtime/
workflow tests). Nine new tests cover minimal projections, foreign job rejection,
single incremental submission, poll completion/budget/unmount cancellation,
retry/cancel paths, ambiguous timeout recovery, Garmin capability gating,
duplicate refresh protection and late-result rejection after changing the day.

Native simulator synthetic walkthrough verified More > Providers, incremental
submission, queued/succeeded status, Back navigation and day Garmin refresh with
partial-category feedback. No live provider mutation/download was used in QA.
Signed embedded Release built successfully with #216's day-history navigation
line locally integrated for the phone artifact; that line was then restored so
this PR stays separate. Production bundle audit passed for hosted HTTPS origins
and excluded synthetic preview and localhost data. Temporary preview removed.

Phone installation initially failed because the paired device connection was
reset; cable reconnection requested. No installed-update success claimed yet.
Combined-source history-navigation regression also passed with #216 and the
new Garmin card together. #216 test session mocking was updated separately so
the two PRs can be merged in either order. No backend/schema change; prior
auth/owner enforcement is reused. Inspected
session.guard.ts additionally confirms native bearer mutations remain authorized
through existing session checks, with browser cookie CSRF kept separate.
