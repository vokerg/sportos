# Walking activity history (#110)

Strava `Walk` summaries create owner-scoped `activities` rows with type `walk`.
They appear in Activities, the Walk filter and activity details with distance,
time, pace, elevation and available heart-rate/energy metrics. Canonical export
includes them as activity history. `Hike` and unknown types remain unsupported;
do not guess their semantics or classify them as walking.

## Scoring boundary

Walking contributes no activity points, run/bike/swim distance, strength sets,
performance events, achievement bonuses or run-step deductions. Rules Studio and
the database do not permit walking rules, and the domain scorer explicitly rejects
walking. A walk-only date does not authorize creating a new scored Daily row.
Existing Garmin all-day steps continue to include walking steps; their established
non-running-step scoring is unchanged. An unlinked walk or missing walking detail
never blocks workout scoring. Partial walking history is distinguished from
incomplete workout discovery; unknown/truncated discovery still fails closed.

## Garmin reconciliation

Explicit day Fetch and targeted activity Fetch support Garmin `walking` as
`walk/outdoor`. Walking uses matching policy v3: same sport, compatible subtype,
UTC start within 15 seconds for a strong match, positive elapsed duration within
max(5 seconds, 1%), comparable moving duration and distance within max(200 m, 5%).
A second, narrower walking criterion accepts identical explicit subtype, start
within 2 seconds, elapsed within 2 seconds and positive distance within max(25 m,
1%). Only this stronger corroboration permits a moving-time difference; the audit
retains the conflict and policy reason without inventing provider semantics.
Exactly one plausible candidate is required, including weak competitors. Never
choose a nearest-distance or same-day candidate. Garmin-only walks stay staged;
existing links and rejected decisions never change automatically. Corrected Strava
metrics stay canonical. Full Garmin resources remain in the separate detail/blob
storage; GET/navigation never downloads them.

V128 adds walking to Activities and Garmin identity constraints and permits
immutable audit versions 1/2/3. Existing rules, links, scores, ledgers and snapshots
are untouched. Explicit Fetch may retry old walking entries that were deliberately
excluded by #108. Older helper day resources may retain walks in `ignoredItems`;
explicit day Refresh rediscovers these under the new policy. Activity-page Fetch
can independently find the walk without requiring a day refresh.

## Retained Strava source backfill

Build packages first, then run the bounded local command:

```bash
pnpm typecheck
pnpm strava:backfill-walks
pnpm strava:backfill-walks -- --apply
```

The default is a dry run. `--apply` is an explicit write. This command requires
non-production `dev-single-user` mode and uses the fixed authenticated legacy
account with the API database role and `withAccountContext`. It never selects an
owner from command arguments or uses schema-owner/dispatcher credentials.

At most 10,000 distinct retained walk identities are selected. The latest skipped
summary per connection/native identity is parsed through the same adapter and
snapshot builder as sync. Invalid observations remain raw and are counted. Each
valid identity commits separately through normal provider ingestion and the
shared reconciliation lock. Raw source UUIDs, bytes/hashes and batches are reused;
distinct native Strava IDs stay distinct even if their metrics coincide;
older skipped walk observations for that identity are linked to the same activity
without rewriting their raw payloads. A current provider link is never overwritten
by old retained data. Ambiguous collisions remain inspectable for review.

Repeated runs converge without duplicate activities or source rows. A failure can
be resumed safely; output contains aggregate counts only. No Strava/Garmin network
request, rich-resource download, credential access, score recalculation, ledger
replacement or snapshot write is performed. Later Strava sync handles new walks
normally; explicit Garmin Fetch supplies additional evidence when requested.
