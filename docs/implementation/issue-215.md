# Issue 215 — open Daily history on its own screen

The owner clarified that a history-row tap updated the summary above the visible
scroll position, making the interaction appear unresponsive. Each history row
now pushes the existing DailyDetail route with its own exact date. Back returns
to Daily history; the top date stepper still browses the summary in place.

Inspected: mobile navigation AppNavigation.tsx/native-tabs.ts/routes.ts,
screens/Features.tsx, daily screens.tsx/contracts.ts/model.mjs, ui/primitives.tsx,
auth useScreenSession.ts/SessionProvider.tsx, package/vitest configuration and
existing daily/release tests. Reviewed current main and open issues/PRs.

Validation: mobile typecheck and a mounted history-tap regression test passed.
Native simulator and device-build verification in progress. Synthetic preview
entry point is temporary and excluded from the production entry/bundle.
No API, scoring, ownership, session or storage change.
