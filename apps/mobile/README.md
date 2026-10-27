# SportOS iPhone client — issue #188

React Native / Expo SDK 57 / TypeScript, separate from the Angular hosted frontend. This application consumes the existing NestJS mobile session contract (#187) and canonical read-only APIs as implemented by follow-up issues. No provider integration, database access, mobile scoring logic, demo credential, or anonymous bypass.

## Workspace / install boundary

This app is **temporarily an isolated pnpm project** inside `apps/mobile` rather than a root pnpm importer. The repository-wide `pnpm-workspace.yaml` explicitly excludes it, so the existing hosted Angular/API frozen lockfile and CI remain unchanged. Expo's large SDK 57 dependency graph **cannot be resolved or safely pinned by a GitHub-only remote agent without registry access**. This is an explicit deviation from ADR 0011's intended full root-workspace integration, and it is an outstanding integration task, **not** a claim of reproducible install or completed #188 acceptance. Once local Codex can resolve packages, prefer integrating `apps/mobile` into the root workspace and committing the updated root `pnpm-lock.yaml`, removing this nested pnpm workspace; alternatively keep the isolation and commit its generated own lockfile with an explicit decision recorded in ADR 0011.

Do not run `pnpm install` at the repository root in an attempt to resolve mobile packages while the project remains excluded.

## Local setup (for local Codex once epic verification starts)

Requires Node 22.22.0, pnpm 9.12.0, macOS with Xcode 26.4+ / iOS simulator. Expo SDK 57.0.23+ and expo-build-properties 57.0.20+ opt into UIKit scene lifecycle for Xcode 27. Ensure VPN/HTTPS reachability to your SportOS API and web login host; V142 mobile auth migrations must already be deployed.

```sh
cd apps/mobile
cp .env.example .env
# Edit EXPO_PUBLIC_SPORTOS_API_URL to your real HTTPS API origin (without /api).
pnpm install --no-frozen-lockfile
pnpm exec expo install --check
pnpm doctor
pnpm typecheck
pnpm test
pnpm ios                 # installs a native development build in Simulator
pnpm start               # connects the installed dev build to Metro
```

The `expo-doctor` package or `pnpm exec expo-doctor` checks native compatibility. The `pnpm ios` command requires Xcode. Physical iPhone builds require a maintainer-controlled signing identity; **do not** check in provisioning profiles, credentials, EAS secrets or developer team IDs. `pnpm start:go` is a preview only, not evidence of Keychain/browser-return or release-build readiness.

Android emulator loopback requires a real reachable host for a non-loopback IP; the default HTTPS-only rule remains. For **local iOS simulator only**, set `EXPO_PUBLIC_SPORTOS_API_URL=http://localhost:3000` and `EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST=true`; this exception is rejected in release builds. Do not use it with real account data on untrusted networks.

## Authentication and security

- Configure `EXPO_PUBLIC_SPORTOS_API_URL` to the **API origin**; no password or token belongs in Expo config. No mocked sign-in is available. API is trusted over HTTPS except explicit localhost debug.
- `src/auth/native.ts` generates two CSPRNG 256-bit values for PKCE verifier/state, calls `POST /auth/mobile/start` through the pure `MobileApiClient` contract at `packages/shared/src/mobile-api.ts`, and opens the server-issued `/mobile-connect` link using iOS `ASWebAuthenticationSession` (`expo-web-browser.openAuthSessionAsync`) so Safari login cookies are available. The password page and approval are **web-only** and preserve Origin/CSRF.
- The callback scheme `sportos://auth/callback` is registered in `app.json`. The shared client verifies scheme, host, path, fields and correlation state; it exchanges the code + verifier once for a server-revocable `smo_` session. Even if another app intercepts a custom-scheme return, a code without the verifier cannot be exchanged.
- The bearer token is held in memory and `expo-secure-store`, using `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Nothing is logged. Aborting login drops the verifier. 401 invalidates the credential; all future API calls should go through the provider's `read` wrapper to update navigation state on expiry.
- Sign-out immediately hides private screens and attempts server revocation. Offline/local-only sign-out displays an explicit warning that server revocation is unconfirmed. No persistent offline personal-data cache is implemented.
- No source-rich data downloads on screen navigation. The current five tabs are infrastructure/placeholders; #189–#193 will consume canonical APIs without inventing scores or fixture data.

## Navigation and accessibility

Five root tabs: Home, Daily, Activities, Run Lab, More, plus nested About and future Activity Detail native-stack routes. The app uses system light/dark mode, safe areas, scalable native text, minimum 48pt targets, accessible button/date labels and non-color-only source labels. Shared primitives include action, card, metric, loading/error/offline/empty/coming-soon panels, semantic pace/distance/duration, local-calendar date control, source badge and an optional accessible mini bar chart. The mini chart does not perform score calculations.

## Local Codex verification checklist — intentionally deferred

1. Resolve the workspace lockfile decision above and verify a **frozen** pnpm install, Expo doctor, TypeScript typecheck and node test suite.
2. Simulator clean build via `expo run:ios` and native launch on SDK 57/Xcode 27 with scene lifecycle (Expo Go alone is not sufficient).
3. From signed out, verify system Safari password/OIDC login, browser approve, callback PKCE exchange, restart/Keychain restore, failed/stale/replayed/malformed callback rejection.
4. Verify bad origin, unexpected authorization target, missing HTTPS, expired/revoked bearer, mismatched cookie+bearer, rejected CSRF bypass, 401 back to sign-in and no leaked tokens in logs/screenshots.
5. Switch dark/light and large text; check VoiceOver and physical touch target sizes on tabs, date selector and nested native back gesture.
6. Verify sign-out online and offline (local-only warning), Safari cancellation, background/foreground transitions and wrong-account authorization. Follow-up #194 owns deeper lifecycle hardening.
7. Confirm root web/API frozen install/build unaffected. Signing, TestFlight and device gates belong to #195 and the maintainer.

### Files inspected before implementation

`AGENTS.md`, `docs/adr/0011-react-native-expo-ios.md`, `docs/AUTHENTICATION.md`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`, `.github/workflows/ci.yml`, `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/mobile-api.ts`, `apps/api/package.json`, `apps/api/src/auth/auth.controller.ts`, `apps/web/package.json`, `apps/web/src/app/app.routes.ts`, `apps/web/src/app/web-auth.service.ts`, `spikes/mobile-expo/package.json`, `spikes/mobile-expo/App.tsx`, `spikes/mobile-expo/index.js`, `spikes/mobile-expo/app.json`, `spikes/mobile-expo/README.md`, `spikes/mobile-expo/tsconfig.json`, `spikes/mobile-expo/pnpm-workspace.yaml`; epic #185, issues #186–#188 and related PRs #198–#199.
