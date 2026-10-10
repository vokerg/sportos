# Explicit Garmin day evidence

On `/daily/:date`, **Fetch Garmin day** retains evidence for one completed
Garmin calendar date. It never recalculates, replaces manual/workbook authority,
changes Strava canonical activity metrics, or writes official scores, ledger
contributions or score snapshots. Page navigation and **View retained Garmin
data** make no Garmin requests.

## Setup and controls

Use the existing [local Garmin setup/login](GARMIN_SINGLE_ACTIVITY.md):

```bash
pnpm garmin:setup
pnpm garmin:login
```

Enable `SPORTOS_GARMIN_LOCAL_FETCH_ENABLED=true` in the protected local `.env`.
New downloads require non-production `dev-single-user` and the fixed legacy
account. Hosted deployments and other accounts may read their own retained data;
they cannot use workstation tokens. Passwords are entered by the user in the
terminal, and tokens remain outside Git and both databases.

Apply primary V125 and separate activity-detail V003 using the existing,
separate schema-owner Flyway settings. Runtime reads/writes use `sportos_app`
inside account context; dispatcher, worker-data, legacy and shared-data roles
have no access to the new day tables.

- **Fetch Garmin day** reuses complete retained categories and complete activity
  resources. An unchanged completed fetch contacts no Garmin endpoint.
- **Retry missing Garmin data** fetches failed/missing categories while preserving
  successful categories. Retained activity identity/resources are checked before
  expensive downloads.
- **View retained Garmin data** expands compact evidence already read from
  SportOS. It works without local Garmin authorization.
- **Refresh from Garmin** explicitly reads all categories again and refreshes
  selected activity resources. Changed content gets a new immutable version;
  identical content converges to the existing version.
- **Inspect retained … resource** reads one bounded auxiliary payload on demand.
  Upstream account/auth/storage fields are removed from browser disclosure.

The selected date is a Garmin-local wall date. Activity discovery queries only
that date plus one day on either side, then selects `startTimeLocal` on the
requested date. `startTimeGMT` remains UTC matching metadata. Missing/invalid
local dates or full discovery pages produce incomplete coverage, never an
invented UTC offset. DST does not require converting date-only values to UTC.
The server and helper conservatively reject their current local date or future
dates; an incomplete day must wait until it has finished.

## Supported categories and fields

The fixed operations were checked against pinned `python-garminconnect` 0.3.17
and a user-selected completed date. Availability remains account/device dependent.
Unsupported fields stay in bounded original auxiliary JSON; they are not guessed
into a canonical metric.

| Category | Pinned operation | Compact evidence |
|---|---|---|
| Movement/energy | dated daily summary endpoint used by `get_user_summary` | exact steps, distance metres, floors ascended/descended, total/active/BMR kilocalories, moderate/vigorous intensity minutes |
| Body | `get_daily_weigh_ins`, `includeAll=true` | every returned measurement: GMT timestamp when present, weight kg, BMI, body fat %, muscle mass kg, bone mass kg, body water % |
| Sleep | `get_sleep_data` | total/deep/light/REM/awake/nap seconds from `dailySleepDTO`; original stage/context arrays retained |
| Heart rate | `get_heart_rates` | minimum/maximum/resting bpm; bounded original readings retained |
| HRV | `get_hrv_data` | last-night mean/high and weekly mean in ms; bounded original readings retained |
| Stress | `get_stress_data` | average/maximum level; bounded original readings retained |
| Body Battery | `get_body_battery(date,date)` | charged/drained values; original day series retained |
| Activities | one bounded compact activities request | count, completeness, per-activity resource/reconciliation status and canonical link when resolved |

Day-view mass fields are grams and are converted once to kg. BMI and percentages
are unscaled. All timestamped weigh-ins remain distinct, including repeated
weights; the API/UI selects no canonical weight. Missing fields remain null,
not zero. A null-only supported summary is shown as **Not recorded**, even when
Garmin returned a nonempty context wrapper. A returned zero remains a real zero.
The summary endpoint is called directly through the same bounded SDK transport
so `privacyProtected` can be retained as **Private**, rather than mistaken for
an authorization exception.

## Storage and partial failures

Raw category JSON is retained first in immutable, owner-scoped
`garmin_day_resources` in the existing detail database. Protected local artifacts
use a content-addressed day folder. Primary `garmin_day_versions` stores only
bounded projections, date/category, Connect origin, retrieval time, availability
and private content identity. `garmin_day_heads` holds the latest attempt and a
same-owner version reference. Previous versions remain immutable. Stale concurrent
attempts cannot replace a newer published attempt.

Connect projections are deliberately separate from manual CSV
`garmin_observations`, which keeps existing CSV step-resolution semantics intact.
Fetching remains evidence-only. Explicit recalculation may consume retained Connect steps and complete strength projections under the #108 policy.

Category states distinguish available, not recorded, unsupported, private,
failed, authentication required and rate limited. A failed category retains its
previous successful version and timestamp. Auth/rate-limit failures stop remaining
upstream category reads while preserving completed categories. Successful
categories survive other category failures. Storage errors cannot publish false
current coverage. Cancellation may leave immutable auxiliary resources without a
primary reference; a retry converges safely.

Activities reuse #97 identity/reconciliation and the #99 original/detail/sets/FIT
retention path. Metadata/local/remote cache checks precede full downloads. Unique
matches enrich existing canonical activities. Ambiguous, unsupported or Garmin-only
activities remain retained/staged, and are never promoted to canonical activities.
Existing canonical links are not silently retargeted. Strength sets retain their
provider units and original resources. No rich Strava request is required.

## API and bounds

```text
GET  /daily/:date/garmin
POST /daily/:date/garmin                  { "refresh": false | true }
GET  /daily/:date/garmin/resources/:category
```

The normal session and CSRF guard applies. Owner identifiers, arbitrary categories,
credentials, paths, storage keys and hash internals are not browser inputs/outputs.
GET coverage reads primary compact data only; it does not load full resource JSON.
Advanced resource reads are explicit and account scoped.

One day operation has eight fixed categories, a single 100-row compact discovery
cap and at most 20 selected activity extractions. An incomplete/full window or
more than 20 selected activities is visibly partial; it is not silently called
complete. Compact candidates with unresolved dates/identities and deferred bounded
candidates remain in the raw day resource for explicit inspection. Each helper process retains the existing maximum of 20 API requests,
0.5-second request spacing, 10/30-second connection/read timeouts, no wrapper retry,
4 MB JSON responses and 20 MiB original limits. Therefore one day workflow has a
finite upper bound of 420 SDK API requests, normally far fewer with cache hits.
Each bridge has a 180-second timeout; the entire workflow is capped at 10 minutes,
and browser cancellation/navigation kills current helper work. Day JSON occupies
at most 32 MB; activity resource/file bounds remain those of #99.

This unofficial API can change or be blocked by MFA, authorization expiry,
anti-bot controls or rate limiting. Actual live failure scenarios are not required
in CI; sanitized transport stubs cover them without passwords or Garmin access.

## Validation and related work

Focused unit/state tests, Python transport tests, fresh/populated primary/detail
migrations, non-owner RLS/privilege tests and an isolated complete day pipeline
cover version convergence, multiple weigh-ins, local midnight/DST, partial failures,
unique/ambiguous/unmatched reconciliation, retained strength sets, cache reuse,
secret exclusions and unchanged official rows. A selected live completed-day fetch
and cached replay also passed with canonical activities, daily facts, ledger and
score snapshots unchanged. No personal source sample or metric is committed.

```bash
pnpm garmin:test
pnpm --filter @sportos/api test -- src/daily/garmin-day.controller.test.ts src/daily/garmin-day-projection.test.ts src/daily/garmin-day.service.test.ts
pnpm --filter @sportos/web test -- src/app/features/daily/state/garmin-day.store.test.ts src/app/features/daily/ui/garmin-day-card.component.test.ts
pnpm typecheck
pnpm build
```

Optional integration files use designated disposable loopback primary/detail
runtime-role URLs. Never run synthetic fixtures against personal/hosted databases.
The root suite skips integrations when those URLs are absent; configure and run
the focused Garmin day/identity/resource integration files separately.

#106 builds on #97, the targeted #99/#101 phases and retained detail concepts in
#100. Historical archive #98, recurring sync, richer Run Lab analytics, canonical
weight selection remain separate follow-ups. Explicit retained-evidence recalculation is documented in SCORING_RULES.md.
See also [CSV daily evidence](garmin-daily-backfill.md).

Endpoint reference: [pinned SDK source](https://github.com/cyberjunky/python-garminconnect/blob/0.3.17/garminconnect/__init__.py).

## Explicit recalculation

After retention, use the existing Recalculate action to apply Connect steps and
complete linked strength sets. Fetch alone never recalculates. See
[authority, classification and fallback policy](SCORING_RULES.md#retained-garmin-recalculation-108).

Walking is excluded from activity extraction, matching candidates, coverage
cards and workout completeness warnings. Its steps remain part of the retained
all-day total. Original bounded discovery evidence remains available in the
advanced resource; no walking canonical activity or link is created. Explicit
Fetch can repair older walking-only failures using retained data, and normal
Recalculate replaces a previously saved misleading workout explanation.
