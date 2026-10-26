# ADR 0011 — SportOS mobile client: React Native + Expo

**Status:** Accepted stack (maintainer decision, 2026-10-25); integration validation pending local device testing  
**Tracks:** #185, #186. Follow-up: #187 (security), #188 (application foundation).

## Decision and boundary

Build an iOS-first **React Native + Expo + TypeScript** client in `apps/mobile` in the existing pnpm workspace. Android compatibility is desirable but not a parallel MVP commitment. **The framework decision is final**; this ADR is not a Capacitor/SwiftUI comparison. The Angular app remains the independently deployed browser UI. The mobile client calls the existing NestJS API for canonical scores, activity details, run performances, route projections and heatmap data. It does not connect to Neon, Strava or Garmin directly, or recalculate official points.

`apps/mobile` is reserved for #188. This issue keeps a disposable feasibility fixture in `spikes/mobile-expo/` **outside** the workspace on purpose. A working Expo package added to `apps/*` must update the root `pnpm-lock.yaml` at the same time; do that in #188 after the local Expo integration gate. Never import the spike's mocked authorization into production.

## Verified from repository source (not device-validated)

- `pnpm-workspace.yaml` already includes `apps/*`; Node is pinned via `.node-version` to 22.22.0. Top-level `tsconfig.json` explicitly lists TypeScript project references and should **not** add a React Native client: Metro/Expo uses its own TS config.
- Web-only Angular 19, ECharts, AG Grid and MapLibre code lives in `apps/web`; it cannot be imported as native UI. `packages/shared` has framework-neutral dates, IDs and Zod contracts, but audit individual exports before allowing a Metro dependency. Do not pull `@sportos/db`, NestJS, Node crypto, filesystem, Angular services or worker logic into native code.
- The deployed API speaks cookie sessions: `POST /auth/password` requires the exact `SPORTOS_WEB_ORIGIN` header, `GET /auth/login` and OIDC callback redirect to the web origin, `SessionGuard` only reads `sportos_session` cookies, and unsafe methods require session-bound CSRF cookie + header. Credentialed CORS allows only the browser origin. **No native sign-in/session contract exists today.**
- `GET /activities` is a canonical owner-scoped read behind `SessionGuard`, not a public endpoint. The public `GET /health` endpoint proves only network reachability, not mobile authentication. Hosted Angular proxies `/api` to Render; no hosted worker / durable source-file storage exists, so do not imply remote jobs finish.

## Native authentication contract for #187 (security gate)

1. Prefer system-browser login (Expo WebBrowser/AuthSession or equivalent) instead of collecting credentials in React Native. During single-user hosting, the browser can use the **existing** web-origin password form with the existing Origin check. Future OIDC must keep authorization-code + PKCE, issuer/subject identity and one-time state.
2. Introduce an **explicit, server-owned mobile handoff**: authorize in the system browser, then exchange a single-use short-lived authorization code bound to a native PKCE verifier and a validated universal/app link. Enforce expiry, one-time consumption, state correlation, redirect allowlist and replay denial. Existing `/auth/callback` currently redirects to web and does not implement this; #187 must add and test the handoff before native protected traffic is enabled. Prefer verified universal links when deployable; if using a custom scheme, interception must not suffice without PKCE.
3. Exchange for a **distinct revocable opaque mobile session** whose digest (never raw token) is stored server-side with owner, idle/absolute expiry and revocation, analogous to existing sessions. Store the raw credential only in iOS Keychain via `expo-secure-store` (not AsyncStorage, logs, URLs, app config, telemetry or backups). Avoid permanent credentials and a second owner source. Simpler MVP: prompt for re-authentication at absolute expiry rather than adding long-lived refresh tokens.
4. Mobile uses `Authorization: Bearer` only over a strict HTTPS API allowlist (development localhost/simulator exceptions explicitly scoped) with no ambient browser cookies. The backend must explicitly distinguish **cookie + session-bound CSRF** from **non-ambient bearer** authentication; keep cookie CSRF/origin/browser/OIDC/Strava flows unchanged, reject ambiguous/conflicting credentials, and fail closed on malformed, expired, revoked or foreign-account sessions. Do **not** allow wildcard credentialed CORS, invent a native `Origin` spoof or embed a static API secret. All canonical reads/writes continue to derive owner from verified server session and forced RLS.
5. Signing out revokes the server session and clears secure storage; a 401 clears in-memory user data, cancels in-flight requests and returns to login. Credentials must never be logged; native screenshots/background app snapshots and deep-link metadata are a privacy consideration. Cover lost-device risk and explicit token revocation.

Security review must include negative tests for missing/invalid/replayed/expired handoffs, URL interception, unauthorized/cross-account reads, CSRF regression in web mode, bearer mutation authorization, logout/revocation and incorrect redirect/origin handling. **A device HTTP call to `/activities` with today's cookie contract is *not* evidence of mobile auth readiness.**

## Application / UX / libraries

- #188: Expo workspace, typed feature-owned API client and session state, navigation with at most five root destinations (Home, Daily, Activities, Run Lab, More), native safe areas, system light/dark preference, dynamic type, large touch targets, semantic units, and loading/empty/error/offline states. Never ship the fixture session from the spike.
- Charts: avoid browser ECharts. Start with `react-native-svg` based deterministic, accessible pace/HR/SWOLF/split primitives, with text/table equivalents for VoiceOver. More complex Skia/chart libraries need local performance verification (fonts, gestures, memory and dark mode).
- Maps: activity route and heatmap **API payloads** are reusable; Angular MapLibre renderer is not. `expo-maps` on iOS uses Apple Maps, supports route polylines but SDK 57's package is alpha and not in Expo Go; heatmap custom tile/overlay support must be proven. A MapLibre React Native development-build integration is the fallback for weighted raster/vector tiles, attribution and bounded viewports. #191 picks the renderer only after hands-on tile/layer testing. Pool swimming has no GPS map; open-water routes may.
- State/formatting: share only reviewed pure TypeScript schemas/units/date helpers. Keep `YYYY-MM-DD` as local calendar dates (not ISO UTC midnight). Fetch activity rich data only on explicit request per backend policy; never on navigation.
- Local native modules: use Expo development builds/prebuild for libraries Expo Go cannot execute; minimize bespoke Swift bridges. iOS build requires macOS/Xcode (and Apple signing for physical-device distribution); no credentials or entitlements should be committed.
- Expo SDK 57 targets React Native 0.86 / React 19.2.3 / Node >=22.13 / Xcode >=26.4. The fixture pins Expo 57.0.23+ and `expo-build-properties` 57.0.20+ with iOS scene lifecycle explicitly enabled for Xcode 27; older SDK 57 defaults can **build but fail to launch** with the iOS 27 SDK. On SDK 58+ the scene property is no longer needed. Sources: [Expo SDK compatibility](https://docs.expo.dev/versions/latest/), [official scene lifecycle guidance](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md).

## Spike and validation status

The isolated `spikes/mobile-expo` prototype mounts a native React Native screen and exercises an explicitly named **fixture-only authenticated canonical-read simulation**. It has no API origin, account credentials, real session, provider data, or network access. It is not a replacement for #187 or #188. The repo's lockfile and hosted CI remain untouched.

| Gate | Evidence / owner |
| --- | --- |
| Framework choice | Approved in #185; locked |
| pnpm workspace layout | Confirmed statically; actual native dependency resolution deferred to #188 |
| Browser session incompatibility | Confirmed from Nest controller/guard and deployment config |
| Native screen / Metro / simulator boot | **Not run remotely**; local Codex / macOS handoff below |
| Authenticated real API fetch and revocation | **Blocked on #187**; mock only here |
| Map route / heatmap overlay | SDK/API investigation only; validate in #191 development build |
| Charts / VoiceOver / dark mode / fonts | Library path identified; native UX/performance unverified |
| Hosted web/API regressions | No production paths or dependency manifests changed |

## Local Codex handoff (run at epic verification, not claimed now)

1. On macOS with Node 22.22.0, pnpm 9.12.0, current Xcode and iOS Simulator: `cd spikes/mobile-expo && pnpm install --no-frozen-lockfile && pnpm exec expo run:ios` (actual local iOS build and launch; `expo start --ios` / Expo Go alone does **not** prove prebuild/Xcode compatibility). The fixture should render, load a simulated authorized activity summary, reject anonymous access and show the fixture label. No signing identity required for simulator.
2. Run `pnpm dlx expo-doctor@latest` and `pnpm typecheck` within the spike; investigate Expo SDK/React Native version compatibility and Metro resolution. This directory is intentionally not installed by root `pnpm install`.
3. For #188, generate/update root `pnpm-lock.yaml` atomically with the new `apps/mobile/package.json`. Prove frozen install and no Angular/API build effect. Native development-build checks require Mac toolchain; real device and TestFlight signing remain human-controlled (#195).
4. For #187, use **test/fixture accounts**, not private production tokens/data; verify native HTTPS API requests, login handoff, expiry, revocation, error and cross-account cases. Do not borrow a browser session manually as a product strategy.
5. For #191, prove activity polyline and actual bounded heatmap tile/raster rendering plus attribution on an iPhone development build. If the library cannot support overlays, document the repro and choose a native MapLibre alternative **within React Native**.

**Unresolved gates are explicitly unverified, not passed.** Escalate a fundamental Expo blocker for maintainer decision instead of changing the approved framework.
