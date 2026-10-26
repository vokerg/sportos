# Expo iOS integration fixture (issue #186)

This directory is a **disposable native feasibility probe**, not SportOS mobile
MVP and not a second frontend to ship. The approved production workspace is
`apps/mobile` (#188), **after** the native-auth contract is implemented (#187).

## Why isolated?

The existing root `pnpm-workspace.yaml` includes `apps/*`, and CI performs a
frozen-lockfile install. This spike has a nested pnpm workspace so native
dependency exploration cannot silently invalidate the main `pnpm-lock.yaml`,
Angular/Render/Vercel workflows or root TypeScript project references.

## What it demonstrates

- A React Native/Expo entrypoint, safe-area context, system light/dark colors, accessible native
  controls, synthetic activity cards and simple native metric bars.
- A small explicit `fixtureSession`-gated **mock read** returning a synthetic run
  and pool swim; anonymous/other-owner requests fail and read results are copied.
- No actual API call, auth token, login bypass, provider credential, private
  activity fixture, location permission, HealthKit or native map library.

The mock is deliberately *not* production authentication and must not be reused
in `apps/mobile`. The real `GET /activities` requires a server session;
`/health` is public but says nothing about mobile session compatibility.

## Local Codex validation (deferred to epic verification)

Requires macOS with Xcode 26.4+ and iOS Simulator, Node 22.22.0 and
pnpm 9.12.0. SDK 57's Xcode 27 compatibility requires `expo@57.0.23+`
and `expo-build-properties@57.0.20+` with scene support enabled in `app.json`.
See [Expo scene lifecycle guidance](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md).

```sh
cd spikes/mobile-expo
pnpm install --no-frozen-lockfile
pnpm test
pnpm typecheck
pnpm dlx expo-doctor@latest
pnpm ios             # Expo Go smoke check (does not test native prebuild)
pnpm exec expo run:ios  # Actual SDK 57/Xcode local native build + launch
```

The nested workspace creates a local lockfile which is ignored because this
spike's dependency versions are exploratory. For the permanent app, commit its
root workspace lockfile and verify `pnpm install --frozen-lockfile`.

Expected interactive checks:

1. iOS simulator launches a screen explicitly labelled a fixture from the local `expo run:ios` development build. Check UIKit scene lifecycle on Xcode 27.
2. Tap **Load synthetic activities**; it displays two non-private records and
   a conspicuous `SOURCE: FIXTURE ONLY` label.
3. Tap **Test anonymous denial**; no activity remains visible and the expected
   denied message appears.
4. Check light/dark scheme, dynamic type, VoiceOver focus/touch targets, and
   offline behavior. These have **not** been validated from GitHub.

If Expo doctor reports version mismatches, record exact diagnostics and adjust
versions in #188 together with a complete lockfile. Device network reachability,
browser-to-mobile session handoff and GPS/heatmap renderer feasibility are *not*
established by this fixture; see
[ADR 0011](../../docs/adr/0011-react-native-expo-ios.md).

No Apple signing, private production credentials, backend mutation, or main
branch merge is authorized by this probe.
