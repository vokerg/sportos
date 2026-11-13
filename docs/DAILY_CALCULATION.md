# Calculate all

Overview on web and Home on native provide an explicit **Calculate all** action.
It recalculates the pending calendar days through today with the existing daily
scorer, using retained primary-database evidence only. It never fetches Garmin or
Strava, runs the helper, or reads the separate detail database. Sync sources first
when fresh evidence is needed. Provider acquisition and scoring have separate
cursors; source Fetch/Refresh and Sync remain evidence-only actions.

The scoring cursor records the first pending seed and the last contiguous
successfully calculated **past** day. Today receives an updated official score
but stays provisional until its calendar day has ended. After catching up through
today, the cursor remains yesterday. Ten separately completed Calculate all
requests today therefore recalculate today ten times. Concurrent duplicate
requests recover the same active job. The same calendar rule handles DST without
requiring a day to be exactly 24 hours long.

The server fixes the end date when a job is queued, using its persisted IANA
calendar. A job crossing midnight completes only its original window; its final
day may then become eligible for completion, and the next click includes the new
day. Dates, owner and cursor are never supplied by clients. A job is bounded to
3,661 days. New accounts start today, using their retained Garmin connection
calendar if present, otherwise UTC. An explicitly initialized account uses the
operator-selected calendar, which cannot later change or move backwards.

Each worker claim calculates one day. Current-lease validation, score/ledger and
append-only snapshot writes, cursor advancement and job progress share one
owner-scoped transaction. A failing calculation rolls that entire day back.
Earlier successful days survive failures and cancellation. Missing evidence stops
at the affected day with `DAILY_DATA_UNAVAILABLE`; it does not invent a zero score
or skip the gap. Retain the missing evidence, then Retry. Scoring behaviour,
manual overrides, imported authority replacement and score provenance are the
same as explicit per-day Recalculate.

Cancellation is cooperative at day boundaries. Stale claims recover with at most
three attempts for the affected day; old lease holders cannot commit a score or
checkpoint. There is one active job per account. Leaving the screen cancels only
client transport. Reopening reads active/latest work. Web polling is bounded to
200 checks/10 minutes; native to 24 checks/two minutes. Both offer manual status,
cancel and retry. Partial or complete terminal work refreshes the score view.

## API

- `GET /daily/recalculation`: read-only completed cursor, first pending day and
  active/latest public job metadata.
- `POST /daily/recalculation`: enqueue/recover a run with an empty body.
- `GET /daily/recalculation/jobs/:id`: owner-scoped status.
- `POST /daily/recalculation/jobs/:id/cancel`: cooperative cancellation.
- `POST /daily/recalculation/jobs/:id/retry`: new run from current progress.

Mutations require the normal authenticated session/CSRF or native bearer flow.
All request bodies must be empty. Foreign and nonexistent identifiers share the
same response. Public jobs contain date range, counts, status, attempt count and
an allowlisted failure code, without owner, lease, source or storage internals.

## Rollout and initialization

Apply primary Flyway **V148** before activating the new API/worker. The separate
detail database needs no new migration for this feature. Existing workers remain
compatible with the additional tables. V148 adds forced RLS, immutable owners and
targets, same-owner/calendar foreign keys and column-specific grants. The API can
enqueue/cancel but cannot complete cursor dates. The dispatcher can claim/recover
queue rows but cannot read scoring cursors or canonical evidence. Scoring uses
only the separate non-owner worker-data role.

To initialize the maintained account's **first unprocessed date** without changing
scores, use the existing non-owner worker-data runtime connection:

```sh
pnpm daily:calculation-seed -- YYYY-MM-DD Europe/Copenhagen
```

This bounded operator command fixes the maintained legacy account; it accepts no
arbitrary owner, rejects future dates and refuses to replace an existing cursor.
It does not enqueue a calculation or fetch sources. The specific rollout seed is
recorded in the implementation issue, rather than in account-agnostic SQL.

See [implementation and validation](implementation/issue-250.md).
