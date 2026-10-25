# Dynamics contribution colors (#177)

Maintainer request: restore the colorful Dynamics score contribution graph;
Daily Log keeps its separate blue contribution palette and red average line.

Inspected before implementation: `apps/web/src/app/rolling-dynamics.view-model.ts`,
its existing view-model tests, `apps/web/src/app/daily-log.view-model.ts`,
`docs/implementation/issue-175.md`, current main and open issues/PRs. The charts
already own independent palettes. No blockers or documentation mismatch found.

Restore the original cyan swim, purple workout, teal rowing, green SUP, orange
HIIT and pink bonus colors in Dynamics. Preserve the neutral Unattributed color.
This affects every selected Dynamics contribution window, including 30 days.
There are no changes to categories, point values, dates, stacking or interaction.

After implementation, re-inspected the changed Dynamics palette and the separate
Daily Log palette. All 12 existing Daily Log/Rolling Dynamics view-model tests,
web typecheck and whitespace checks passed. No tests were added for color
constants; no templates or bundling integration changed. Browser verification
was not run. No privacy, ownership or scoring implications.
