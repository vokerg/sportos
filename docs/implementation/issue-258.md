# Indoor cycling at 750 points/km (#258)

The maintainer raised indoor cycling from 700 to 750 base points per kilometre:
10 km earns 7,500 before independent speed bonuses. V149 introduces a nullable
`indoor_bike_coefficient` on the existing rule version. Null retains historical
700/km semantics; standard enabled bike-base rules receive a new UUID with 750.
Outdoor remains 600/km; unspecified keeps its configured fallback (standard 650).

Both repository rule mappers and rule publication preserve the override. The
existing guide reads the authoritative domain coefficient. New bike-base proposals
normalize omission to 750, including existing clients which only send the generic
coefficient. The pure engine still supports historical 700/km rules without an
override. This avoids silently changing the meaning of an existing rule UUID.

V149 updates identified non-imported ledger contributions using retained inputs,
updates base/total points and appends snapshots in the same migration transaction.
It preserves custom families, disjoint effective ranges, historical snapshots,
imported `All` authority, bonus points and canonical/source facts. Old Excel
700/km evidence stays original. No provider or production operation is required
for source-code review or merge; applying V149 to a deployed database is a
separate rollout step.

## Validation

- Domain: 198 tests passed, including provider/manual inputs, mixed subtypes,
  rounding, separate speed bonuses, imported authority, historical/current guide
  output, validation and preview delta.
- Disposable loopback Postgres 16: all 58 fresh migrations through V149 passed.
- Populated V148 → V149: 20 owner/date cases passed, including manual/imported,
  outdoor/unknown, two owners, custom authority and disjoint rule ranges. Verified
  ledger totals, original imported rows/ledger, old rule definitions, immutable
  snapshots and retained facts metadata. Invalid override shapes are rejected.
- Non-owner app/dispatcher/worker-data tests: six tests passed across indoor
  scoring and existing cycling bonus suites, including account seeding, explicit
  recalculation, history, foreign denial, preview, publication and recomputation.
- Importer unit tests: 29 passed; nine database-dependent tests skipped because
  their separate integration URLs were not configured.
- API rule controller: four tests passed. API/worker builds and DB typecheck passed.

To reproduce the populated upgrade on a disposable database: migrate to V148,
load `scripts/indoor-bike-upgrade-fixture.sql`, migrate to latest, then run
`scripts/verify-indoor-bike-upgrade.sql` with `psql -v ON_ERROR_STOP=1`.
The runtime checks are
`pnpm --filter @sportos/db exec vitest run src/repositories/indoor-bike.repository.integration.test.ts src/repositories/bike-bonus.repository.integration.test.ts --no-file-parallelism`,
with `SPORTOS_OWNER_TEST_DATABASE_URL` set to the disposable loopback app-role
connection (database name ending `_test`) and separate worker roles enabled.

Inspected files and roadmap criterion are recorded in PR #259. Documentation
mismatch resolved: historical Excel 700/km is retained as evidence, while the
current catalog now explicitly states the new SportOS 750/km policy.
