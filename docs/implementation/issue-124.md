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


## Maintainer-directed distance and sparse-pause tolerance follow-up

The maintainer requested a slight, explicitly bounded distance allowance and
repair of the remaining Strava summary fallbacks. Current code/projections,
V133/V134 constraints, migration inventory, retained native distance/timer fields,
Strava moving stream contract, adapter stream retention, domain/DB/UI tests and
these operation docs were inspected before extending the repair. Strava's
[official moving-stream contract](https://developers.strava.com/docs/reference/#api-models-MovingStream)
defines sampled booleans without an exact interval-allocation rule. The bounded
sparse-stop convention below is deliberate application policy, not documented
provider timer certainty.

Algorithm v4 accepts measured shortfalls within 0.1% capped at 10 m, using actual
window time and offsets rather than invented terminal samples. Native source and
active coverage remain unchanged. Near-target Garmin summaries no longer skip FIT
reads prematurely. Summary-only estimates remain strictly source bounded.

Sparse Strava intervals over 30 seconds that end at a stopped marker, with at
most 10 m distance change and a moving resume sample within 30 seconds, are
excluded as bounded pauses. Selected windows crossing them carry an explicit
qualification. Other long active/mixed gaps still split sections, and Garmin
mixed timer intervals remain fail-closed. Actual selected-section coverage is
preserved even when a tolerated near-target section wins. V135 admits only these
known qualification reasons and enforces the labeled distance allowance in SQL,
including denial of unlabeled shortfalls and out-of-bound coverage. Existing
ownership, grants and immutable history remain intact; no schema types changed.

Follow-up validation completed:
- 16 domain tests, including every target at/just beyond tolerance, no invented
  duration/endpoints, combined distance/pause qualification, selected short-section
  coverage, and rejection of unbracketed/large-motion/fully active gaps.
- 15 non-owner primary/detail integration tests, including bounded SQL checks,
  unlabeled shortfall denial, near-5 km Garmin preflight and independent sources.
- 6 component and 4 API boundary tests; root typecheck passed.
- Fresh migration through V135 and populated V134 -> V135 upgrade passed; the
  synthetic upgrade baseline verified unchanged canonical/scoring/performance
  rows and no implicit projections. Final schema uses explicit non-null reason
  checks so PostgreSQL nullable CHECK semantics cannot admit unlabeled shortfalls.
- Applied V135 to the configured local app, then retained-only reprocessed just
  the selected run. Both providers now calculate 5/10/15/20/half-marathon targets,
  with explicit distance or bounded-pause qualifications where used. The 25 km
  target is still unavailable. Current source/active distances are retained.
  Before/after official rows are identical; repeated processing is already_current
  and preserves the complete read model.

No provider requests, bulk history apply, private fixtures or canonical/official
writes. Heavy general CI and browser visual inspection remain unrun. PR #125 is
updated with the complete repair and remains unmerged.

## Maintainer-directed presentation follow-up

Before presentation changes, inspected the active issue #3/#124 and PR #125;
`docs/FRONTEND_ARCHITECTURE.md`; Activities running-effort component/model/tests,
activity metric models/view model/comparison component/tests, detail page,
provider-detail view model/tests, activity list/page and provider-status component;
Daily provider source icons/tests; primary activity metric status/projection code
solely to verify the existing compact coverage contract. No auxiliary query or
provider fetch is needed for icon rendering.

Requested behavior: omit unavailable effort distances, use average/fastest pace
for run speed metrics while preserving cycling speed, share Daily's provider
icons in the activity list, distinguish retained detail/summary/unknown and
attention states, and remove redundant list Source text/column. This is display
only; preserve metric authority, independent provider values and raw provenance.


Presentation outcome: unavailable-only distances are omitted from the table and
per-target diagnostics, while one-source results/empty/stale/failed states remain
usable. Run speed values are displayed as average/fastest min/km pace, merging
native pace once per provider; cycling stays speed. Garmin retained session/lap
run speed fields use pace when their native unit is m/s. Shared provider SVG marks
now serve both Daily and Activities, with S/✓/?/! coverage/attention markers,
accessible labels and a one-line legend. Linked presence and retained detail are
read from existing primary metadata; normalization success is never treated as
proof of rich retention. Source column/card text are removed; filters and detail
provenance remain intact.

Further inspected `model/activity-metrics.models.test.ts`, `docs/ACTIVITIES.md`
and `packages/db/src/activity-metric-projector.ts` to verify compatibility and
retention semantics. The first shared icon used field decorators that the current
Vitest JIT transform does not support; component input metadata now supplies the
same typed plain inputs and passes both JIT tests and Angular AOT build.

Presentation validation completed: 82 focused frontend tests passed across
activity metric models/view models, provider metric comparison/status, retained
provider formatting, running-effort presentation and Daily provider icons. Web
typecheck and production build passed. No backend, database or
provider behavior changed; no extra migration or database suites are required.
Browser visual verification was attempted but no browser was available through
the configured computer-use tool; DOM component assertions and AOT build passed.
