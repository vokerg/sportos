# System Liquid Glass and native MVP gaps (#208)

Inspected: AGENTS.md; ADR 0011; mobile App, app/package config, navigation routes
and AppNavigation, shared UI/theme, Home/Daily/Activities/Run Lab/More, native test
mocks; PCE current tab-bar implementation/package/README; native tab adapter and
inset documentation; open issues and merged native PRs.

PCE's original custom glass container was superseded by the system tab controller.
SportOS follows that current design using pinned native tabs and its React
Navigation adapter. Five destinations and the parent native detail stack remain;
SF Symbols are native on Apple platforms and generated template PNGs on Android.
No custom translucency, bar background or selection drawing overrides the system.
Manual bottom padding uses the measured bar height; auth/detail screens don't
reserve tab space. Session teardown and feature focus cancellation remain intact.

Validation: mobile TypeScript passed. Native rebuild and runtime checks in progress.

Remaining gaps identified:
- #195 requires a physical iPhone, Apple Developer team, signing and explicit
  distribution/privacy signoff. A simulator or Hermes export cannot satisfy it.
- Existing production JS export must be complemented by a native embedded Release
  build; no signed device/archive result is asserted yet.
- Physical-device VoiceOver, maximum Dynamic Type, keyboard/map gestures,
  app-switcher snapshots, network loss/cold starts and battery remain operator
  checks. Fixture-based offline/timeout/revocation tests already pass.
- Hosted worker/durable storage and historical catch-up remain separate backend
  limitations, not implemented by a native UI change.
- #196/#197 remain deferred after the maintainer delegated the scope choice; no
  HealthKit, notification, widget, lock-screen or new data permission is added.

No private screenshots, credentials, GPS, provider payloads or build outputs are
committed. Human gate and source authority remain unchanged.
