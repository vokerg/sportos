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
