# Cycling bonus per completed 10 km (#183)

Qualifying cycling previously awarded a flat 1,000 bonus points per ride.
The new standard rule awards `floor(distanceM / 10000) × 1000`, independently
for each canonical ride. A synthetic 30 km qualifying ride earns 3,000.
The existing average-speed threshold of 19.9 km/h remains in force.

## Integrity and publication

- `completed_10k_blocks` is explicit in domain, database and transport types.
- Domain scoring records canonical distance, speed, block count, configured
  points, awarded points and the exact immutable rule UUID.
- Rule descriptions explain the blocks and retain accurate historical flat
  descriptions. Proposal/database constraints restrict the multiplier to the
  ungrouped cycling speed family and its inclusive speed operator.
- V141 replaces only standard enabled definitions, preserving disjoint ranges.
  Customized cycling families keep their existing authority.
- Publication, affected non-imported contribution replacement, total deltas and
  new snapshots are atomic. Imported scores, canonical facts, base points,
  unrelated contributions and prior snapshots remain intact. Snapshot metadata
  is retained. The account seed function copies the versioned catalog.
- Running and swimming formulas are unchanged. No provider downloads are needed.

## Validation

Passed locally:

- Complete domain suite: 185 tests, including 24 new cycling cases and existing
  running/swimming regressions.
- Non-owner disposable database tests: cycling and swimming, six tests covering
  seeding, recalculation, exact ledger linkage, snapshot preservation, foreign
  denial, preview and split dispatcher/worker-data recomputation.
- API Rules controller/guide: five tests. Angular read-only guide: three tests.
- Repository-wide `pnpm typecheck` and `git diff --check`.
- Fresh Flyway migration through V141 on disposable PostgreSQL 16.
- Populated V140-to-V141 upgrade with synthetic accounts, disjoint ranges,
  customized rules, distance/speed boundaries, separate rides, imported/manual/
  calculated authority, unrelated points and retained snapshot metadata.
- Injected ledger-insertion failure rolled back publication and score history;
  removing the injection and retrying passed the same upgrade assertions.
- Local development migration applied successfully on the configured database.
  Account-scoped before/after fingerprints confirmed canonical activities,
  imported scores, base points, prior snapshots and unrelated ledger entries
  were preserved. Browser verification showed the corrected three-block bonus,
  matching ledger/app totals and its calculation explanation. No personal
  records, fingerprints or screenshots are committed.

The full repository test/build matrix and remote CI database integrations were
not rerun locally. No frontend templates, routing or providers changed. The PR
remains unmerged pending maintainer authorization.

## Inspected files and documentation mismatch

Read `AGENTS.md`, `README.md`, `docs/{ARCHITECTURE,ROADMAP,AUTHENTICATION,
AI_ANALYSIS,FRONTEND_ARCHITECTURE,SCORING_RULES}.md`, ADRs 0004/0008, the primary
migration inventory/DDL (especially V114/V117/V126/V139/V140),
`.github/workflows/ci.yml`, root/domain/db/API package manifests,
`packages/domain/src/{types,scoring,rules-studio,rule-guide}.ts` and their tests,
`swim-bonus.test.ts`, `packages/db/src/{schema,ownership-context,index}.ts`,
`packages/db/src/repositories/{daily,scoring,rule-changes}.repository.ts`,
`swim-bonus.repository.integration.test.ts`,
`apps/api/src/{db.provider.ts,rules/rules.service.ts,rules/rules-guide.service.test.ts}`,
`apps/web/src/app/{score-breakdown.models.ts,features/rules/model/rules.models.ts,
features/rules/pages/rules-page.component.test.ts}`,
`scripts/{flyway,dev,dev-supervisor}.mjs`, `.env.example`, and the existing
swim-kilometre upgrade fixture/verification scripts. The new migration, cycling
tests and upgrade scripts were self-reviewed. README's schema status lagged at
V139 while main contained V140; this change updates it to V141 and documents the
new cycling semantics. Roadmap criterion: deterministic, explainable scoring
with immutable versions and preserved provenance.
