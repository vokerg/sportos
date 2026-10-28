# Native Run Lab (#192)

Inspected: AGENTS.md, README.md, docs/ARCHITECTURE.md, ROADMAP.md,
AUTHENTICATION.md, AI_ANALYSIS.md, adr/0011-react-native-expo-ios.md,
DISTANCE_LEADERBOARDS.md; mobile auth, navigation, Features, UI primitives/theme,
calendar formatting, package/tsconfig; API performance controller; web performance
models/client/leaderboard page; DB distance-leaderboard repository; domain running
efforts pause-policy contract. Reviewed #185/#192 and dependencies/recent merges.

Read-only native leaderboard uses existing server catalog/ranks and bounded
20-row pages. Distance tabs, quick/exact local-calendar ranges, previous/next
pages, coverage, historical Excel vs moving/timer-active time and alternative
records remain explicit. Estimates and stale data never enter the server ranking.
Original achievement detail projects only factual allowlisted fields, with linked
run navigation and truthful missing evidence. No notes, filenames, source hashes,
raw provider records, account selection or recalculation. Same activity can appear
at multiple distances; duplicate occurrences remain server-deduplicated.

Validation: mobile TypeScript and 29 Node tests pass (four new performance cases).
Tests cover target/range/paging validation, same run/multiple distances, original
timing/alternatives, missing optional evidence, malformed responses and privacy.
Native rendering, live API parity and lifecycle verification follow in epic QA.
No backend, schema, scoring, provider or Angular changes. Physical-device release
acceptance remains separate. No merge authorization has been requested.

Local follow-up: native response projection passed against the configured real
leaderboard. Date controls and coverage details are collapsed by default for phone
layout. Screen requests use the shared focus-scoped cancellation adapter (physical
transport cancellation is provided by #194). Full native Run Lab interaction
verification remains a clearly tracked follow-up, not a claimed physical-device pass.
