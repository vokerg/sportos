# Non-scoring walking history (#110)

Maintainer explicitly reprioritized walking after merging #108/#109. Branch
`issue-110-walking-activities` starts from current main. Acceptance: retain Strava
walks in Activities, support conservative Garmin linkage, exclude walking from
scores/workout evidence requirements, then idempotently process retained skipped
Strava summaries without downloads or changes to existing official history.

Inspected before implementation: AGENTS.md, README.md, docs/ARCHITECTURE.md,
docs/ROADMAP.md, docs/AUTHENTICATION.md, docs/AI_ANALYSIS.md,
docs/FRONTEND_ARCHITECTURE.md, docs/adr/0010-garmin-activity-reconciliation.md,
issue #3, open issues/PRs, all primary migration filenames and relevant activity
constraints V002/V118/V124/V127; domain types/scoring/activity-matching; DB schema,
providers/activities/daily-scoring/daily-workout repositories; Strava adapter and
worker sync runner; Garmin day service/projection and helper extract/discovery;
web activity contracts/view model and projection CLI.

Documentation mismatch: #108 excludes walks from linking; this maintainer request
supersedes that exclusion for activity history only. Walking remains non-scoring.
AGENTS.md and roadmap still call merged #109 a draft; update those references.

Invariants: owner context and original raw provenance, provider-native identity,
immutable Garmin audit policy versions, no guessed matches or Garmin-only
canonical promotion, canonical Strava metrics remain authoritative, no implicit
score writes or rich provider downloads during backfill.
