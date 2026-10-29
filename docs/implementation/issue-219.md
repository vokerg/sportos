# Issue 219 — native product language and useful daily metrics

Owner requested direct action labels, no storage-class names, recognizable daily
source marks and useful Garmin metrics instead of a category/retention inventory.
This PR is stacked on #218; #216 remains the separate day-navigation change.

Inspected: native Daily/ScoreHero/GarminDayCard, provider projections/workflows/
tests, Activity contracts/model/screens, maps screen, web Garmin-day card/models,
API Garmin-day projection and cockpit repository providerSources semantics. Prior
entry-point/architecture/auth guidance and current main/open PRs were reviewed.

Uses compact existing Garmin numeric projections only: steps, sleep stages,
heart rate, HRV, stress, energy, Body Battery gained/used and body measurements.
Only explicit allowlisted values enter state. Missing values are omitted; zero
is preserved. Multiple weight observations use the latest timestamped measurement;
ambiguous undated measurements are not guessed. UI weight is Garmin observation,
not a canonical score input or authority change. Partial fetch failures keep prior
metrics and a short failure message. No raw JSON, resource fetch or new API call.

Daily logos represent API-reported source presence; no data and unchecked states
stay distinct. Existing data does not claim a fresh sync. Source-record class was
removed from activity projection and UI. Route/stats/lap/provider action copy is
shortened; useful missing-data, scoring authority and source limitations remain.
No scoring, provider policy, ownership, session, storage or permission change.

Validation: mobile typecheck and all 67 tests passed (40 model and 27 runtime/UI/
workflow tests). New regressions cover health-unit formatting, missing versus zero,
latest timestamped weight, ambiguous undated observations, old values after partial
failure, source-name filtering and loaded/missing/unchecked provider marks. The
combined #216 history-navigation regression also passed; its test SVG isolation
was updated separately.

Native simulator synthetic review verified Home source marks, day-detail health
metrics, expanded/collapsed measurements and light/dark appearance. Signed Release
build passed with #216 day navigation locally integrated for the phone artifact;
the line was restored afterwards to keep PR scope isolated. Production bundle
audit verified hosted origins/new UI and absence of old diagnostic labels,
synthetic fixtures and localhost. Temporary preview removed.

Installed successfully on the personal iPhone. Automated launch was blocked by the
locked device; the owner can open the updated app after unlocking. No actual-device
health-data freshness or provider-fetch result is claimed from synthetic visual QA.
No private source content, screenshots or build products are committed.

## Owner refinement — compact history

Day-history rows now put 15–16px source icons beside the date, without wordmarks
or status panels. Colored/gray marks and tiny state indicators preserve source
presence, with full accessible labels. Removed the large inline selected-day
summary so history is reachable without scrolling past a duplicate detail view.
A small date selector opens the separate day screen, including dates without a
saved score. Removed the now-unused selected-day fetch/effect. Activity labels
use Avg speed / Avg HR consistently in list, detail and metric filtering.

Compact-list validation: mobile typecheck and all 67 tests passed; compact icon
mode preserves accessible source states without visible wordmarks. Native
simulator review used a synthetic 12-day history and verified multiple days fit
on screen. Embedded Release and production-origin/fixture-exclusion bundle audit
passed; phone refresh installation is recorded in the session. No screenshots or
synthetic fixtures were committed.
