# Home training refresh

Maintainer-directed work continues on `feature/services-strava-shortcut`, preserving
its existing Services and Strava shortcut changes. No backlog issue was selected,
no new branch was created. The maintainer subsequently authorized a squash merge.

Investigation inspected README.md, docs/ARCHITECTURE.md, docs/ROADMAP.md,
docs/AUTHENTICATION.md, docs/AI_ANALYSIS.md, docs/FRONTEND_ARCHITECTURE.md,
apps/mobile/README.md, both Home implementations, web Overview tests, Daily
transport/models, mobile daily contracts/model, shared analytics calendar helpers,
Activities repository/controller, mobile theme and workspace package/test configs.
Open issues/PRs and recent origin/main history were checked. The supplied AGENTS
summary predates current README migration status; this change requires no migration.

Web and native Home now show 30-calendar-day averages of recorded daily facts,
with an explicit coverage count and recorded-day denominator. These are display
aggregates of persisted totals, never a recalculation of official scores or a
replacement for the server's rolling-score analytics. Seven-day distances/counts
use server Activities summaries independently per sport (not a truncated preview).
The three recent sessions remain separate from three recent scored days. All
windows include today and use local calendar dates. Reads never fetch providers,
change scores, or persist personal data. Existing explicit Strava actions remain.

Validation: focused Overview and shared aggregate tests, web architecture checks,
web/native typechecks, web production build and mobile test suite. Interactive
visual review is unavailable because the computer-use browser host is unavailable;
the signed embedded Release was subsequently installed and launched on the paired
iPhone, and the maintainer confirmed the updated Home looks great. Full physical
MVP/privacy/accessibility acceptance remains outside this focused UI review.

Follow-up inspection included the existing web activity list/presenter/provider
status and native Activities screen/projection/contracts, plus their tests and
shared native format declarations. Fixed decimal-string aggregation before
addition (Postgres numeric transport), with regression coverage for repeated
decimal strings and missing/nonfinite metrics. Extracted the existing single
activity card on both platforms and reused it in Home and Activities. Home now
uses the existing canonical Activities client/projection rather than a separate
preview presentation/transport. Correct `/activity/:id` web navigation is inherited
from the common card. Focused card/presenter, Home and average regression tests
cover the changes; architecture/type/build checks remain the validation boundary.
