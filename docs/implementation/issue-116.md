# Daily visual hierarchy (#116)

## Pre-implementation inspection

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/AUTHENTICATION.md`
- `docs/AI_ANALYSIS.md`
- `docs/FRONTEND_ARCHITECTURE.md`
- `docs/adr/0008-imported-ledger-authority-and-explicit-recalculation.md`
- `docs/adr/0010-garmin-activity-reconciliation.md`
- `apps/web/package.json`
- `docs/GARMIN_DAY_FETCH.md` (inspected before documentation changes)
- `apps/web/src/app/score-breakdown-panel.component.ts`
- `apps/web/src/app/score-breakdown-activities.component.ts`
- `apps/web/src/app/score-breakdown-provenance.component.ts`
- `apps/web/src/app/daily-detail-page.component.ts`
- `apps/web/src/app/score-breakdown-garmin.component.ts`
- `apps/web/src/app/score-breakdown-summary.component.ts`
- `apps/web/src/app/score-breakdown-facts.component.ts`
- `apps/web/src/app/score-breakdown.models.ts`
- `apps/web/src/app/score-breakdown-activities.component.test.ts`
- `apps/web/src/app/score-breakdown-panel.component.test.ts`
- `apps/web/src/app/daily-detail-page.component.test.ts`
- `apps/web/src/app/features/daily/ui/garmin-day-card.component.ts`
- `apps/web/src/app/features/daily/ui/garmin-day-card.component.test.ts`
- `apps/web/src/app/features/daily/state/garmin-day.store.ts`
- `apps/web/src/app/features/daily/model/garmin-day.models.ts`

Read issue #3 and its claim comments; no open PRs. Current main: 94acb67. Maintainer explicitly reprioritized this work.

Documentation mismatches: queue and roadmap retain old draft/open descriptions for merged Garmin and frontend work. Source records exclude Connect evidence stored separately, so the existing “Every source record” claim is misleading. This change corrects the local presentation, without expanding storage or scoring.

Invariant: presentation separates daily totals, canonical sessions and auxiliary Garmin evidence. Tabs never trigger downloads or scoring. Exit criterion: concise first glance with full calculations and source inspection still reachable.

## Delivered behavior

Overview contains totals, explicit actions, five-column sessions and Garmin metrics.
Manual daily-total rows, steps and bonus pseudo-activities are omitted from sessions
without deleting or changing any stored facts. Score preserves authority notes,
Excel comparisons, fact splits, step/workout explanations and the full ledger.
Sources preserves original source records, CSV observations and explicit Connect
JSON inspection. A single projected Garmin card survives view switches; only date
changes reload coverage. Provider actions remain explicit.

Garmin badges derive from retained day activity links; they do not imply full rich
coverage or promote unlinked activities. Missing categories and raw values remain
available in Sources. Human formatting preserves zero and does not change original
precision. No database, backend, scoring, auth or export changes.

## Validation

- Seven focused Daily/presenter/Garmin test files: 26 tests passed.
- Web typecheck and production build passed.
- Live local browser: Overview separates totals/sessions and shows linked Garmin;
  Sources exposes separately retained Connect categories; Score preserves details.
  Desktop and 390px viewport reviewed; temporary viewport restored.
- Browser review used read/navigation only, with no Fetch, Refresh, score, manual
  edit, raw resource read or other writes.
- Root/backend/database/worker suites intentionally skipped for frontend-only work
  per repository validation policy. Draft PR #117; issue remains open until merge.

## Maintainer-requested reconciliation investigation

Inspected before recording findings:

- `packages/domain/src/activity-matching.ts`
- `packages/db/src/repositories/garmin-activities.repository.ts`
- `packages/db/package.json`
- Built matching-policy module (read-only replay)
- Selected day’s authenticated compact score-breakdown, Garmin coverage and
  bounded reconciliation-list GETs; no raw resource JSON was needed.

The two reported cycling records have retained Garmin counterparts, each with
exactly one candidate. Start, elapsed duration and distance corroborate the same
session. The reported moving durations disagree beyond the policy’s
`max(5 seconds, 1% of the larger moving duration)` bound. That leaves a weak
candidate and therefore `ambiguous`, even without competing candidates. This
status currently combines uncertainty about metrics with multiple-candidate
ambiguity. It does not mean the Garmin record is absent.

Stored decisions used policy v2. Read-only replay under current v3 reproduces the
same weak candidates and metric-conflict reasons, so a cached retry under the
current policy cannot resolve this by itself. Original Garmin resources remain
retained and unlinked; badges represent links, while overview values remain
canonical Strava facts. Linked Garmin values can be viewed independently on the
activity detail page without replacing canonical values.

No matcher, identity, source, score or link was changed. Automatically accepting
such rides would require an explicit narrow, versioned cycling-policy amendment
with independent start/elapsed/distance corroboration and unchanged uniqueness,
collision, ownership and immutable-link safeguards. Raising the general moving
time tolerance would also weaken matching for unrelated sports and is not an
investigation fix.

Investigation validation: compact GET evidence and current-policy replay agree.
No provider network requests or writes occurred. Personal dates, native IDs,
canonical IDs, source payloads and exact personal measurements are excluded from
this committed record. This follow-up is documentation-only; no additional
runtime test matrix was required.

## Retained matching improvement preflight

Maintainer explicitly expanded #116/#117 to audit all exported Garmin activities
and improve automatic pairing. Inspected domain matcher/tests, primary
reconciliation repository/integration tests, schema types, account context/pool,
day repository/read mapping, activity enrichment, retained backfill scripts,
package commands, CI and every primary migration declaration (full V124/V127/V128).
V130 is the latest; V131 must preserve audit versions 1–3. Runtime audit also
compared separate-detail identity coverage with primary identities. No private
source sample or identity is committed.

Exit criterion: audit all retained identities, explain every pending outcome,
accept only independently corroborated unique pairs, preserve historical audits
and established/rejected links, and prove canonical/scoring/source equality.
The earlier frontend-only validation limit does not apply to this scope expansion.

## Versioned retained matching delivery

The authorized full retained audit classified all pending identities. Existing
walk/run/swim/workout links were intact; pending native cycling identities each
had one Strava candidate with exact start and tightly corroborated elapsed and
distance. Moving-time disagreement was the only veto. Separate detail identity
coverage had no entries without corresponding primary metadata. No personal
counts, dates, identifiers or measurements are committed here.

Policy v4 adds only the independent cycling corroboration path documented in ADR
0010. V131 preserves all historical policy rows and changes no canonical/scoring
data. Repository preview/replay uses the existing owner transaction lock; bounded
keyset paging avoids skipping pending rows as earlier records link. The local
operator CLI is read-only by default and accepts explicit `--apply`. Rejections,
existing links, occupied candidates, missing data, fallback identities and
competing candidates remain protected. New reasons distinguish a weak sole
candidate, missing counterpart, competing candidates and an occupied link.

Validation:

- Domain matcher: 28 tests passed, including new cycling bounds, disagreement,
  competing/weak candidates, ordering, missing/zero/unknown and unrelated sports.
- Non-owner PostgreSQL reconciliation: 12 integration tests passed, including
  preview without writes, apply/repeat, cross-owner denial, rejected decisions,
  immutable links/history, stable paging and dispatcher denial.
- Fresh Flyway: all 40 migrations through V131 passed on isolated PostgreSQL 16.
- Populated V130→V131: canonical/identity/source-version/audit fixtures unchanged;
  policy versions 1–3 preserved, new policy 4 accepted by `sportos_app`.
- Split-role provider-sync worker integration: two tests passed with the
  non-owner dispatcher/worker-data identities.
- Root typecheck, available repository tests and production build passed.
  Unconfigured unrelated database/API/worker integrations remain skipped; the
  matching integration above was separately configured and fully executed.
- Live non-owner preview identified only independently corroborated pairs. V131
  was applied through the separate schema-owner Flyway identity; explicit retained
  replay linked every pending pair. Existing source metrics were normalized via
  the existing retained projector with no downloads. A repeated replay was empty.
- Before/after owner-scoped in-memory digests verified unchanged canonical
  activities, daily metrics, ledgers, snapshots, performance, rules, raw sources,
  Garmin immutable versions/strength/day evidence and original detail resources.
  Every established link and previous audit row stayed byte-for-byte equivalent;
  only new policy-v4 links/audits and derived provider metrics were added.
- Read-only live day reload verified Garmin badges on all displayed sessions and
  no pending day entries. No Fetch, Refresh or recalculation was invoked.

This supersedes the earlier investigation-only conclusion under current policy
v3. #117 remains draft; no merge or issue completion is implied.

Additional inspected paths during validation/documentation:

- `packages/db/src/ownership-context.ts`, `packages/db/src/pool.ts`,
  `packages/db/src/index.ts`, `packages/db/src/garmin-activity-schema.ts`
- `packages/db/src/repositories/garmin-day.repository.ts` and its integration test
- `packages/db/src/activity-metric-projector.ts`,
  `packages/db/src/activity-metric-backfill.ts`
- `apps/api/src/db.provider.ts`,
  `apps/api/src/daily/garmin-day.service.ts`,
  `apps/api/src/activities/activity-enrichment.service.ts`,
  `apps/api/src/activities/activity-metrics.service.ts` and enrichment integration
- `apps/worker/src/provider-sync-runner.integration.test.ts`
- `scripts/activity-metrics-backfill.mjs`, `scripts/strava-backfill-walks.mjs`,
  `scripts/flyway.mjs`, `package.json`, `packages/db/package.json`
- `.github/workflows/ci.yml`, `AGENTS.md`, `docs/ACTIVITIES.md`,
  `docs/GARMIN_SINGLE_ACTIVITY.md`, `docs/implementation/issue-108.md`,
  `docs/implementation/issue-112.md`, `docs/implementation/issue-114.md`

Existing documentation mismatch: historical policy reason `POLICY_V2` was still
emitted by policy v3; current outcomes now carry the correct policy and explicit
blocking reason. Historical JSON and audit history are left intact.
