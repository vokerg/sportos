# Evidenced-pause running effort repair (#124)

Maintainer explicitly reprioritized this repair after #122. Investigation found
that fully stopped distance increases invalidated otherwise usable retained
Strava streams and Garmin FIT. The existing whole-timeline validation was too
strict for this case. No private provider data or activity identifiers are
included in these notes or fixtures.

Before implementation, inspected:
- `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`,
  `docs/AUTHENTICATION.md`, `docs/AI_ANALYSIS.md`, `docs/FRONTEND_ARCHITECTURE.md`;
- `docs/RUNNING_EFFORTS.md`, `docs/adr/0010-garmin-activity-reconciliation.md`;
- issues #3/#122, #122 claim comments, open PR inventory;
- `packages/domain/src/running-efforts.ts`, `running-efforts.test.ts`, and package manifest;
- `packages/db/src/running-effort-projector.ts`, `repositories/running-efforts.repository.ts`,
  `repositories/running-efforts.repository.integration.test.ts`, and package manifest;
- root/API package manifests and `scripts/dev.mjs`.

The invariant is pause-excluded analysis using each provider independently,
without crediting stopped distance, guessing mixed timer-transition distance,
contacting providers or changing canonical/scoring/performance data. Algorithm
version 3 will qualify existing version-1 projections as stale until explicit
retained reprocessing. V133 supports versioned immutable projections. Inspection of its quality
constraint showed that calculated results required a null reason. Additive V134
permits only the explicit partial-stream-coverage reason on calculated Strava
windows, preserving all existing metric bounds, RLS, grants and history. The version-1 zero-distance pause requirement in
`docs/RUNNING_EFFORTS.md` must be updated with this deliberate policy correction.

Additional inspection: all primary migration inventory/prior #122 migration
review, V133 constraints, `scripts/flyway.mjs`, web effort models/component/tests,
and `packages/db/src/running-effort-projector.ts`. Strava unknown recording gaps
are now qualified by independent continuous sections; never join across gaps.
Targets without a continuous window retain honest summary estimates.

Validation completed:
- 13 pure calculation regressions: stopped drift/movement exclusion, actual source
  versus active coverage, no target qualification using stopped distance, resets,
  continuous sections, fractional boundaries and no stitching across unknown gaps.
- 14 non-owner primary/detail integrations on isolated local Postgres: projection,
  mixed calculated/estimated targets, restricted qualification constraint,
  version-1 stale/reprocess, replay, isolation/dispatcher denial and unchanged
  canonical/daily/ledger/snapshot/performance rows.
- 4 API boundary tests and 5 web component tests; root `pnpm typecheck` passed.
- Fresh migration through V134 and populated V133 -> V134 Flyway upgrade passed.
  An initial integration attempt used an unmigrated detail test database; corrected
  to the existing migrated isolated detail database before the passing run.
- Applied additive V134 to the configured local application's primary database,
  then explicitly recalculated only the selected run. Garmin 5/10/15/20 km and
  Strava 5/10 km are calculated; Strava longer targets remain honest estimates
  because no continuous retained section covers them. Repeat is already_current.
  In-memory before/after canonical and its day scoring/ledger/snapshot/linked
  performance comparisons passed across migration and calculation.

No provider downloads, bulk backfill or private fixtures. Full general CI and
browser visual inspection were not run. No template/routes/providers changed;
focused component validation and web/root typecheck cover the presentation change.
The PR remains unmerged pending maintainer merge instruction.
