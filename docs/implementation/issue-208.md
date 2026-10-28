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

Validation: mobile TypeScript, 40 model tests and 13 native-runtime/mounted-
lifecycle/release-config tests passed; Expo Doctor 21/21; GitHub CI green. Debug
native build installed/launched with zero errors and two generated-toolchain
warnings. All five system glass tabs were selected directly in the simulator.
Home/Daily/Activities/Run Lab/More loaded; More's final action clears the floating
bar after scrolling; About and Daily details hide it and Back restores selection.
Light/dark appearance passed. The temporary CUA coordinate-input limitation was
resolved after the maintainer unlocked the Mac; direct tab-touch checks passed.

An embedded native Release for both simulator architectures built successfully
with explicit hosted HTTPS origins. Final artifact audit found no configured
private values or local API/web origins; arbitrary transport remains disabled and
the unused Face ID description is absent. The unsigned simulator build could not
access Keychain and correctly hid private data. Rebuilding with normal local
ad-hoc simulator signing resolved that: clean signed-out launch, production PKCE
start, system browser handoff to the real hosted login and safe cancellation all
passed. No production credentials were entered and no full hosted login or device
archive is claimed. The development app's existing local session survived the
origin change and was restored for review.

Live local PKCE/API-projection/revocation smoke passed again. Hosted health first
timed out at 45 seconds, then both direct API and web-proxy checks returned healthy
on retry. This is an observed startup-delay limitation; authenticated hosted
workflows still require operator acceptance.

Gap corrections: preview builds now use the same explicit HTTPS origin gate as
production/local Release. Tests reject missing, HTTP, credential-bearing and
path-bearing origins and the insecure-localhost flag. SecureStore's unused Face
ID permission description is disabled: session access uses Keychain without
biometric prompts. The concrete operator matrix is in `docs/MOBILE_QA.md`.

Remaining gaps identified:
- #195 requires a physical iPhone, Apple Developer team, signing and explicit
  distribution/privacy signoff. A simulator or Hermes export cannot satisfy it.
- Native embedded simulator Release is now verified. A real signed device/archive
  and complete authenticated hosted walkthrough remain unverified.
- Physical-device VoiceOver, maximum Dynamic Type, keyboard/map gestures,
  app-switcher snapshots, network loss/cold starts and battery remain operator
  checks. Fixture-based offline/timeout/revocation tests already pass.
- Hosted worker/durable storage and historical catch-up remain separate backend
  limitations, not implemented by a native UI change.
- #196/#197 remain deferred after the maintainer delegated the scope choice; no
  HealthKit, notification, widget, lock-screen or new data permission is added.

No private screenshots, credentials, GPS, provider payloads or build outputs are
committed. Human gate and source authority remain unchanged.
