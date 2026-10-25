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

## Implementation and validation

In progress. Successful-check metadata will stay inside the existing
owner-scoped day head metadata; immutable payload versions remain unchanged.
No schema, scoring rule, automatic synchronization or chart-cutoff change.
