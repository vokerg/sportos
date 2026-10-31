# Stats hub

> Follow-up: the Average Pace / Speed placeholder described below has now been
> implemented; see [Average Pace / Speed trends](average-pace-speed-trends.md)
> for its aggregate API, chart, table, and threshold controls. This document
> retains the original Stats hub delivery history.

Maintainer-directed frontend task, implemented from current `main` without
selecting unrelated backlog work. Open issues and PRs and recent merged PRs
(including #228) were reviewed; no competing Stats implementation was found.

The authenticated web navigation now opens `/stats`. Its first card opens the
existing `/monthly-stats` report, preserving bookmarks and query controls. Its
second card opens `/stats/average-pace`, a placeholder with a Running/Bike selector
and sport-specific title/units. Both reports link back to Stats. The placeholder
does not request data or calculate averages. Native navigation is outside this
web-page change.

The frontend exit criterion is a reachable Stats hub and placeholder, with the
current monthly report preserved. Authentication remains in the existing shell;
there are no API, ownership, storage, privacy or scoring changes. Existing docs
describe Monthly Stats as a standalone route; that route remains valid, with the
hub added as its navigation entry. The roadmap's older schema version is unrelated
to this frontend task and was not used as an implementation requirement.

## Investigation files inspected before implementation

- `AGENTS.md`, `README.md`
- `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/AUTHENTICATION.md`,
  `docs/AI_ANALYSIS.md`, `docs/FRONTEND_ARCHITECTURE.md`
- `docs/adr/0005-authentication-and-data-ownership.md`,
  `docs/adr/0007-read-only-ai-analysis.md`
- `apps/web/package.json`
- `apps/web/src/app/app.component.ts`, `apps/web/src/app/app.routes.ts`,
  `apps/web/src/app/app.routes.test.ts`
- `apps/web/src/app/features/services/pages/services-page.component.ts`
- `apps/web/src/app/monthly-stats-page.component.ts`,
  `apps/web/src/app/monthly-stats-page.component.test.ts`
- `apps/web/src/app/score-breakdown-activities.component.test.ts`
- `apps/web/src/styles.css`

## Validation

- Passed 10 focused route/monthly-report tests across `app.routes.test.ts`,
  `monthly-stats-page.component.test.ts` and `monthly-stats.view-model.test.ts`.
- Passed `pnpm check:web-architecture` (206 files and eight guardrail cases),
  `pnpm --filter @sportos/web typecheck` and the web production build.
- Browser review at mobile width confirmed ordered hub cards, navigation to the
  placeholder, Running default, Bike switching to Average Speed / km/h, and the
  return link. No provider fetch or score mutation was used for validation.
- `git diff --check` passed. Backend/database suites are outside this frontend
  scope. PR #229 remains unmerged pending maintainer authorization.

The report uses Strava as its fixed source of truth for both averages and volume;
its activity drill-down uses the same source. Workbook/manual distance entries
are excluded. See [report details](average-pace-speed-trends.md).
