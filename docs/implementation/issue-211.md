# Issue 211 — read-only athlete handoff

This work advances the read-only analysis boundary to explicit local MCP clients
and a reproducible private athlete handoff. No provider ingestion, scoring or
IronMan repository changes are included. Private artifacts must remain outside
all Git worktrees, including ignored directories.

## Investigation

Current main at investigation: `58fba23`. Issue 211 has no prerequisite issues,
claim or implementation PR; open PR list was empty. Recent PRs 202–210 concern
mobile work and do not implement this scope. Issue 153's historical catch-up is
not a prerequisite: retained evidence is used as-is with coverage caveats.

Files inspected before implementation:

- `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`,
  `docs/AUTHENTICATION.md`, `docs/AI_ANALYSIS.md`;
- ADRs 0005 and 0007; `docs/ACTIVITY_METRICS.md`, `docs/RUNNING_EFFORTS.md`,
  `docs/DISTANCE_LEADERBOARDS.md`;
- root `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`,
  `tsconfig.base.json`, analytics/db package and TypeScript configuration;
- `packages/db/src/index.ts`, `pool.ts`, `schema.ts`, `ownership-context.ts`,
  `activity-metric-schema.ts`;
- repositories `activities`, `distance-leaderboard`,
  `activity-distance-corrections`, `activity-metrics`,
  `activity-provider-resources`, `garmin-activity-resources`, and
  `run-classification.ts`;
- `packages/domain/src/activity-metrics.ts`,
  `apps/api/src/auth/session.guard.ts`, `scripts/historical-runs.mjs`,
  `.github/workflows/ci.yml`;
- IronMan `AGENTS.md`, `STATUS.md`, `athlete/profile.md`,
  `performance/README.md`, `performance/forecasts.md`, `training/README.md`,
  in an isolated read-only checkout. No personal contents copied here.

Existing corrections, source-local calendar dates, provider projection freshness
and immutable running leaderboard semantics are reused. Older architecture and
analysis documents mention earlier migration milestones; current main is V142.
Those historical references do not imply pending prerequisites.

## Boundaries

The pure snapshot contract/calculations live in analytics. Compact primary reads
live in db. The local application composes them inside account-bound,
repeatable-read, read-only transactions. The stdio server cannot accept an owner
argument or perform a write. The operator configures the binding locally.

The report is Russian; JSON uses stable English fields and explicit units.
Private artifact filenames and sanitized validation outcomes may be recorded in
public status; personal values, identifiers and artifact contents may not.

## Implementation and review

- Pure `sportos.athlete-snapshot.v1` calculations in analytics; strict executable
  and published JSON Schema contracts; shared `AthleteReadService` for local CLI
  and MCP. Canonical corrections and existing running leaderboards are reused.
- New compact primary and allowlisted detail repositories; freshness/source/parser
  checks; missing canonical HR/calories/ascent may have separately labelled
  provider observations without filling canonical fields.
- Official SDK v2 stdio server with exactly five tools, operator-only account
  binding, non-owner role assertions, account context, read-only repeatable-read
  transactions, bounds, concurrency/request limits and sanitized errors.
- Restricted, atomic private JSON/Russian report/manifest writer outside all Git
  worktrees. Twenty report chapters, annual/monthly/52-week tables, discipline
  evidence and explicit interpretation limits; no external generation or writes
  to IronMan.
- Self-review improved repeated-bucket aggregation complexity, retained Garmin
  lap support, FIT timer/moving distinction, optional detail failure handling,
  current-day metadata, source-method labels and schema stability tests.

Additional files inspected during implementation/review: primary migrations
V004/V105/V105_1/V106/V108/V124/V129/V140, all primary migration scripts during
transactional replay in a disposable PostgreSQL cluster, dedicated detail V001–V004,
`packages/db/src/repositories/{ownership,activity-metrics,distance-leaderboard,activity-distance-corrections}.repository.integration.test.ts`,
`apps/api/src/activities/{activity-provider-detail.service,activity-timeline,activity-swim-lengths}.ts`,
and official MCP TypeScript SDK v2 server/client/stdio documentation and installed
type declarations. No schema migrations or existing scoring logic changed.

## Validation

- `pnpm install --frozen-lockfile`: passed.
- `pnpm typecheck`: passed, including existing API/worker/web/mobile and new MCP.
- Analytics: 7 tests passed.
- MCP: 13 tests passed with separate non-owner primary/detail test connections,
  including all five tools via a real stdio subprocess and generic SDK client.
- Existing activities, distance-correction and distance-leaderboard integrations:
  10 tests passed against disposable non-owner runtime connections.
- The disposable local PostgreSQL 16 cluster replayed all 51 primary migration
  scripts transactionally through V142 and the four separate detail migrations
  through V004. This was synthetic validation, not a migration of operator data
  and not a new Flyway migration-engine test.
- Real private artifact generation, executable schema validation, deterministic
  report/JSON equality, manifest hashes, 0700/0600 permissions and independent
  account-scoped totals/window checks were performed locally. Real-data MCP smoke
  validation used only retained data. No athlete values or identifiers are
  recorded here.

CI adds the non-owner MCP ownership/stdio gate when its primary integration
connection is configured. Optional detail integration requires
`SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL`; it was exercised locally. The full
worker/importer suite and frontend production bundles were not rerun: no writes,
provider ingestion, scoring implementation or frontend code changed. Hosted MCP
transport, remote authentication and deployment are intentionally out of scope.

Private handoff basenames are `athlete-snapshot-2026-10-28.json`,
`athlete-performance-report-2026-10-28.md` and `manifest.json`. Actual locations and
contents remain in the private local handoff. Issue remains open pending review
and separately authorized squash merge; no merge was performed.
