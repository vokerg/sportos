# Issue 99 targeted first phase

Maintainer authorization: single-activity local Garmin lookup/download precedes
full archive #98. #97 is implemented in dependency draft PR #103. Branch was
created from current main and fast-forwarded to the dependency; this PR targets
the dependency branch and owns only #99 changes. Bulk incremental sync, historical
archive ingestion and #101 UI are deferred, not claimed complete.

Before implementation inspected: all #97 investigation files, GitHub #99/#98/#97
and #3, docs/garmin-daily-backfill.md, upstream python-garminconnect README,
releases, pyproject.toml, example.py, garminconnect/__init__.py, client.py and
activity implementation at pinned release 0.3.17. A real activity target was
provided privately and must not appear in committed fixtures/docs.

Invariants: local interactive authentication/MFA only, protected tokens outside
repo, no browser-cookie extraction or plaintext password retention; bounded
single-activity I/O; metadata/cache preflight before original download; raw detail
and original bytes retained outside primary; normalized metadata only enters the
shared resolver; no canonical Garmin-only rows or implicit scoring writes.
