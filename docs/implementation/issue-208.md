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

Validation so far: mobile TypeScript, 40 model tests and 13 native-runtime/
mounted-lifecycle/release-config tests passed; Expo Doctor 21/21. CI passed the
initial native-tab implementation. Debug native build installed/launched with
zero errors and two generated-toolchain warnings. System glass bar is visible;
Home-to-Daily navigation selects the system tab, score detail hides the bar and
Back restores Daily. Direct coordinate interaction is temporarily unavailable in
CUA (`noWindowsAvailable`); no direct tab-touch pass is claimed yet. Embedded
native Release compilation and final runtime checks are in progress.

Gap corrections: preview builds now use the same explicit HTTPS origin gate as
production/local Release. Tests reject missing, HTTP, credential-bearing and
path-bearing origins and the insecure-localhost flag. SecureStore's unused Face
ID permission description is disabled: session access uses Keychain without
biometric prompts. The concrete operator matrix is in `docs/MOBILE_QA.md`.

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
