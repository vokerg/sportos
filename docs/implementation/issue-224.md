# Day actions on iPhone (#224)

Web already exposes all four actions on `/daily/:date`. Native day detail now
places the same actions at the top, including empty dates. They reuse existing
native bearer/session transport and owner-scoped API routes. No backend, database
migration, scoring policy or web implementation changes are required.

- Strava uses `webhook_refresh` with the same UTC-offset envelope as web. Only a
  succeeded job triggers date-specific recalculation. Failed/cancelled jobs do
  not. Status checks cap at 24 over two minutes and can be explicitly resumed.
  Failed enqueue responses recover by exact requested range and recent creation
  time; ambiguous/missing candidates fail closed without another submission.
- Garmin reads compact coverage on opening; explicit refresh uses the server's
  capability and refreshes existing partial evidence, even without metric values.
  It does not recalculate. The health card and top action share one request state.
- Recalculate calls the existing date endpoint. Manual entry loads current
  canonical facts before editing, preserves indoor/outdoor/unspecified distances,
  validates bounded finite values, and sends a PUT. All-day step deduction and
  official scoring remain server responsibilities. Save errors keep the draft.
- Request guards reject double submissions, cancellation aborts on blur/unmount,
  and route keys isolate changed dates. Provider errors remain generic. No new
  storage, provider credentials, raw payload state, offline write queue or owner
  selection is introduced.

## Investigation

Inspected README.md; docs/{ARCHITECTURE,ROADMAP,AUTHENTICATION,AI_ANALYSIS,
FRONTEND_ARCHITECTURE}.md; docs/adr/0010-garmin-activity-reconciliation.md;
apps/mobile/README.md, package.json, vitest.config.ts;
apps/mobile/src/daily/{screens.tsx,contracts.ts,model.mjs,model.d.mts,GarminDayCard.tsx};
apps/mobile/src/providers/{model.ts,use-operation.ts,screens.tsx};
apps/mobile/src/auth/useScreenSession.ts; apps/mobile/src/ui/primitives.tsx;
apps/mobile/test/{provider-controls.test.tsx,daily-navigation.test.tsx,native-mock.ts};
packages/shared/src/mobile-api.ts;
apps/web/src/app/{daily-detail-page.component.ts,score-breakdown.models.ts,
score-breakdown-api.service.ts,score-breakdown-manual-facts.component.ts,strava-day-refresh.ts};
apps/web/src/app/features/providers/{model/provider.models.ts,data-access/provider-api.service.ts};
apps/api/src/daily/{daily.controller.ts,daily.service.ts};
apps/api/src/providers/providers.controller.ts;
packages/db/src/repositories/daily.repository.ts.

Reviewed current main and merged #218/#220, open issues and PRs before branching.
Documentation mismatch: native guide described day reads and Garmin-only actions;
updated to describe the explicit scoring/manual workflows. Canonical integrity and
account authorization stay in the existing API; no new roadmap milestone.

## Validation

Mobile typecheck; complete mobile tests (40 pure model tests, 38 mounted/config
checks including ten new day-action tests); existing web day page tests (5).
The focused tests cover empty-day visibility, no writes on navigation, targeted
sync-before-recalculation, failure handling, polling budget/manual continuation,
ambiguous enqueue recovery, duplicate protection, manual subtype/unit validation,
server score authority and late-save cancellation.

Production iOS JavaScript/Hermes export passed. At the maintainer's explicit
request, the signed embedded Release was rebuilt with hosted HTTPS API/login
origins and installed/launched successfully on the paired personal iPhone on
2026-10-29. Signature verification and bundle checks confirmed all four action
labels, both hosted origins and absence of local API/web origins. A transient
connection reset on the first install resolved after reconnecting. No live provider
download/scoring mutation or owner UI acceptance is claimed by this installation.
Garmin helper and Strava worker availability remain deployment requirements.
