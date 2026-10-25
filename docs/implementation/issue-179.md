# Provisional Garmin day evidence (#179)

Allow explicit fetching of today's Garmin evidence while keeping the day
incomplete until it has been checked after the local calendar date ends. This
advances the usable local cockpit/provider workflow; fetching remains evidence
only and Recalculate continues to use retained evidence explicitly.

## Investigation

Inspected before implementation:

- `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`,
  `docs/AUTHENTICATION.md`, `docs/AI_ANALYSIS.md`,
  `docs/FRONTEND_ARCHITECTURE.md`, `docs/GARMIN_DAY_FETCH.md`, ADRs 0008/0010.
- Root, API, web and DB package scripts; `scripts/garmin-local.mjs`.
- API daily Garmin controller/service/projection and their tests/integration;
  `packages/db/src/repositories/daily-scoring.repository.ts`;
  Garmin day repository and integration tests.
- Web Garmin day card/model/store and their tests;
  `daily-detail-page.component.ts` and its tests.
- `tools/garmin/fetch_day.py`, `activity_bridge.py`, `test_fetch_day.py`.

Reviewed open issues and claims, no open PRs, recent merged PRs
#168/#170/#171/#174/#176/#178, and current origin/main `40b4cc6`.

Documentation and both date gates currently require a completed date. The
service treats category coverage as completeness. Immutable source retrieval
timestamps cannot record a successful recheck returning identical bytes.

## Implementation

The API controller and Python helper accept today, retaining future/invalid-date
rejection. The API returns calendar completeness separately from category states:
`in_progress`, `refresh_required`, or `complete`. Full current-day evidence stays
partial; after midnight each category needs a post-day successful check. The UI
explains the provisional status and the Refresh-then-Recalculate workflow.

The existing owner-scoped head attempt JSON stores `checkedAt` for successful
checks, including unsupported categories without a source version. A failed
attempt preserves that marker. Successful identical payloads reuse the immutable
version while confirming a new check. Checks use the request start time, so
requests spanning midnight stay provisional. Legacy evidence uses the retained
retrieval timestamp, or a successful versionless attempt. API/helper dates follow
the workstation's local calendar; there is no new timezone inference or timer.

Fetching remains evidence-only; explicit recalculation can use retained partial
data and later replace it with refreshed evidence. Historical snapshots stay
immutable. No schema, scoring rule, automatic synchronization or chart-cutoff
change. The architecture's stale claim that Connect evidence never participates
in score resolution was corrected to describe the existing #108 behavior.

Self-reviewed every changed source/test/doc file, including the new API calendar
helper and its tests and the new end-to-end provisional/recalculation case in
`apps/api/src/daily/garmin-day.integration.test.ts`. Also inspected V125, detail
V001/V003 and the account-context implementation for persistence validation.
The introductory Connect-flow guidance in `docs/garmin-daily-backfill.md` was
also inspected and updated for provisional dates and existing retained scoring.

## Validation

- Focused API calendar/controller/service and daily controller tests: 35 passed.
- Focused Garmin day card/store and daily detail page tests: 25 passed.
- `pnpm garmin:test`: 20 passed, 1 skipped optional dependency test; no provider
  network requests. Includes fetching all categories for today.
- API (including DB/package graph) and web typechecks passed.
- Web production build and architecture checks (8 regression tests) passed.
- Disposable loopback PostgreSQL 16 cluster: applied all 49 existing primary
  migrations through V140 and all 4 detail migrations through V004. The existing
  detail V001 expects the database name `sportos_activity_detail`; renamed the
  disposable detail database accordingly after the first attempt rolled back.
- Real `sportos_app` non-superuser/non-bypass role: Garmin day repository
  integration 5 passed, including unchanged-version confirmation, failed-check
  preservation, versionless unsupported checks, cross-owner denial and immutable
  provenance. Dispatcher and worker-data denial assertions also passed.
- API Garmin day integration 2 passed: retained/reconciled categories leave
  official rows unchanged; today's provisional fetch can be recalculated, then
  next-day late evidence stays score-neutral until another explicit recalculation.
  Earlier score snapshots survive. Recalculation makes no bridge requests.
- `git diff --check` passed. The disposable server was stopped after validation.

No personal databases, private provider payloads or live Garmin downloads were
used. Live browser/provider verification and the unrelated full repository matrix
were not run. Delivery and merge status are tracked in PR #180 and issue #179.
