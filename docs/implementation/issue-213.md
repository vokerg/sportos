# Issue 213 — native visual polish

Maintainer requested a visual refresh after personal iPhone installation.

Inspected before implementation: AGENTS.md, README.md, docs/ARCHITECTURE.md,
docs/ROADMAP.md, docs/AUTHENTICATION.md, docs/AI_ANALYSIS.md, ADRs 0007/0011,
apps/mobile/README.md, App.tsx, package.json, app.config.ts, app.json,
src/ui/theme.tsx, src/ui/primitives.tsx, src/navigation/AppNavigation.tsx,
src/screens/Features.tsx, src/daily/{screens.tsx,contracts.ts,model.mjs},
src/activities/screens.tsx, src/performance/screens.tsx,
src/auth/{SessionProvider.tsx,useScreenSession.ts}, test/native-mock.ts,
test/session-lifecycle.test.tsx and scripts/mobile-smoke.mts. Current origin/main,
open issues/PRs, recent merges and #195 comments were reviewed. No implementation
PR overlaps. Existing QA docs predate the owner's installation in this session;
that installation does not establish all device acceptance scenarios.

## Presentation

Warm neutral surfaces, forest/lime score hero, cohesive light/dark tokens,
scalable numeric typography, local SVG sport marks, quieter source badges,
distinct navigation rows, ranked achievement accents and a branded sign-in.
Decorative track lines are not a progress/fitness gauge. Score values, category
contributions, authority, missing-data states and explicit provider controls stay
server-derived. Native Liquid Glass tabs and authentication remain unchanged.
No new dependencies, remote assets, permissions, backend calls or data storage.

## Validation

- Mobile typecheck passed.
- Existing 40 model tests and 13 runtime/lifecycle/release tests passed.
- Native iPhone 17 Pro simulator inspection with temporary synthetic fixtures:
  Home, Activities, Run Lab and More; light/dark palettes; accessibility-medium
  Dynamic Type. Found and fixed score wrapping; large-text supporting metrics stack.
  The temporary entry point was removed and is absent from the device bundle.
- Production entry point sign-in screen rendered on simulator with hosted HTTPS origins.
- Embedded Release device build passed; installed on the connected personal iPhone
  16 Pro Max. Automated launch was blocked by the locked phone; user unlock
  requested. Installation succeeded. Bundle audit verified hosted origins and new UI, and absence of the
  synthetic fixture, sample account and local development origins.
- Native Liquid Glass navigation remains in place. No comprehensive physical-device
  accessibility, authentication or privacy acceptance is claimed by visual QA.
  Existing release/lifecycle tests cover the unchanged auth boundary.

Follow-up review compacted filter controls, put ranked results before the detailed
coverage panel, and kept missing activity distance from becoming a large dash.
Final source typecheck and whitespace checks passed. No backend/database validation
was required for this presentation-only change. PR is left unmerged for maintainer
review; #195 still owns full device and seven-day refresh acceptance.

No private records, screenshots, auth material or build products are committed.
