# SportOS iPhone app — issue #188

React Native + Expo SDK 57 + TypeScript, maintained alongside the independent Angular UI. It consumes the existing NestJS API and `packages/shared/src/mobile-api.ts` mobile auth contract (#187), never Angular components, owner-supplied identifiers, browser cookies or provider credentials. Screens other than authenticated scaffolding remain explicit feature placeholders for #189–#193; no invented training results.

## Installation and environment

`apps/mobile` is a **normal root pnpm workspace importer** (`apps/*`) with its complete dependencies committed in the root `pnpm-lock.yaml`. Root `pnpm install --frozen-lockfile` installs it with other workspaces; `tsconfig.json` at repository root intentionally excludes native files, which use Expo's own TypeScript/Metro configuration. The Expo package graph was generated with `pnpm install --lockfile-only --ignore-scripts` on a GitHub runner. This is package resolution, **not** validation of build/run or an iOS device.

Prerequisites: Node 22.22.0, pnpm 9.12.0, macOS with Xcode >=26.4 and iOS Simulator. SDK 57 uses `expo-build-properties` scene support to launch with the iOS 27 SDK. Native Apple signing/TestFlight remains maintainer-gated in #195. Server V142 must be deployed to allow mobile PKCE handoffs.

```sh
# Repo root (do not generate another lockfile)
pnpm install --frozen-lockfile
cp apps/mobile/.env.example apps/mobile/.env
# Configure exact HTTPS origins in apps/mobile/.env, with no paths, tokens or passwords.
# EXPO_PUBLIC_SPORTOS_API_URL=https://your-api-host
# EXPO_PUBLIC_SPORTOS_WEB_ORIGIN=https://your-web-login-host
pnpm --filter @sportos/mobile doctor
pnpm --filter @sportos/mobile typecheck
pnpm --filter @sportos/mobile test
pnpm --filter @sportos/mobile ios   # physical native simulator build, NOT Expo Go
pnpm dev:mobile                    # connect Metro to the installed development build
```

For local simulator-only backend testing, `EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST=true` and `EXPO_PUBLIC_SPORTOS_API_URL=http://localhost:3000` permit loopback HTTP in __DEV__ builds only; use `EXPO_PUBLIC_SPORTOS_WEB_ORIGIN=http://localhost:4210` if your browser login is local too. No insecure non-loopback host is allowed. Production must use the deployed HTTPS origins. For a physical iPhone, local `localhost` resolves to the phone itself, not your laptop. The app intentionally has no fake login or user-data fixture.

## Native session security

- A CSPRNG makes fresh 256-bit PKCE verifier/state pairs; the API receives the SHA256 challenge and state via unauthenticated `POST /auth/mobile/start`. Neither the verifier nor account credentials enter a browser URL, log or app config.
- The returned authorization URL must match the exact configured HTTPS web origin, `/mobile-connect` path and single `request` parameter. `expo-web-browser.openAuthSessionAsync` uses system authentication UI, not a WebView, to let the server-owned browser password/OIDC flow and web-only CSRF approval run normally.
- The single-use `sportos://auth/callback?code=...&state=...` custom scheme is registered in `app.json`. `MobileApiClient.finishSignIn` verifies URL scheme/host/path, exact state, two query fields and one-time code before the verifier-bound exchange. A stolen callback code alone cannot be used without the original verifier.
- The resulting `smo_` bearer session is held only in memory and iOS Keychain through `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (no AsyncStorage); `MobileApiClient` sends it only to the configured API origin over HTTPS and never sends browser cookies.
- A 401 purges the mobile session, cancels outstanding requests and removes private navigation. Sign-out hides private screens, clears local storage and attempts server revocation. When offline, the UI explicitly warns that revocation was not confirmed; there is no persistent cache or mobile-only scoring state. #194 will add deeper lifecycle/offline hardening.

## Navigation and presentation

Five root destinations: Home, Daily, Activities, Run Lab, More; native nested-stack About and future Activity Detail. Dark/light system theme, safe-area support, scalable text, >44pt touch areas and accessibility labels are built in. Reusable Card, Action, Metric, SourceBadge, StatusPanel, DateStepper and MiniBars primitives keep date-only strings in local-calendar time and render metric units as metres/km, duration and pace. The chart is presentation-only; server-derived scores remain authoritative.

## Local Codex acceptance (deferred to epic QA)

1. Confirm frozen root install, `expo install --check` / `expo-doctor`, mobile typecheck/unit tests and unaffected Angular/API tests and builds; check native dependency resolution from outside `apps/mobile`.
2. Clean simulator Xcode/Metro build and actual launch on iOS 26/27 SDK (Expo Go does not prove native packaging); verify scene lifecycle, iOS package identifier and intended physical-device signing configuration.
3. Browser sign-in: password/OIDC, web confirmation, PKCE exchange and app scheme callback, expired/replayed/duplicate code rejection, mismatched state, URL-interception attempt, Safari cancellation, and rejected HTTP/unexpected web origins.
4. Verify Keychain session restore after restart, logout online/offline, revoked/expired bearer response and forced private UI teardown on 401; rejected CSRF cookie-bearer mixing, account ownership and wrong-owner read attempts.
5. Exercise VoiceOver tab labels, dark/light and large text, nested back gesture, date controls, contrast and 48pt targets; check background/foreground privacy. The latter privacy work continues in #194.
6. Confirm normal web/API build and deploy paths remain unchanged, including hosted read limitations. No App Store/TestFlight submission or production credentials without maintainer approval.

## Investigation files

`AGENTS.md`, `docs/adr/0011-react-native-expo-ios.md`, `docs/AUTHENTICATION.md`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`, `.github/workflows/ci.yml`, `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/mobile-api.ts`, `apps/api/package.json`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.service.ts`, `apps/web/package.json`, `apps/web/src/app/app.routes.ts`, `apps/web/src/app/web-auth.service.ts`, `spikes/mobile-expo/package.json`, `spikes/mobile-expo/App.tsx`, `spikes/mobile-expo/index.js`, `spikes/mobile-expo/app.json`, `spikes/mobile-expo/README.md`, `spikes/mobile-expo/tsconfig.json`, `spikes/mobile-expo/pnpm-workspace.yaml`; #185–#188, PRs #198–#200.
