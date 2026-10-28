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
