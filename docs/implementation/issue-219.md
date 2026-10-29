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

Validation in progress: mobile typecheck, projection/workflow/UI regressions,
native light/dark layout and embedded Release installation. No private source
content, screenshots or synthetic QA entry points are committed.
