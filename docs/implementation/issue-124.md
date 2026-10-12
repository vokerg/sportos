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
version 2 will qualify existing version-1 projections as stale until explicit
retained reprocessing. V133 already supports versioned immutable projections;
no schema change is needed. The version-1 zero-distance pause requirement in
`docs/RUNNING_EFFORTS.md` must be updated with this deliberate policy correction.

Validation pending.
