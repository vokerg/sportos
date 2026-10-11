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
