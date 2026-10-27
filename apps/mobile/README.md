# SportOS iPhone app — issues #188–#190

React Native + Expo SDK 57 + TypeScript, maintained alongside the independent Angular UI. It consumes the existing NestJS API and `packages/shared/src/mobile-api.ts` mobile auth contract (#187), never Angular components, owner-supplied identifiers, browser cookies or provider credentials. Home and Daily read persisted server scores and canonical activity previews from #189. Activities now supplies a paged/filterable canonical feed and sport-specific detail (#190), while Run Lab and analytics remain placeholders for #192–#193. No invented training results.

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

## Native Home and Daily (#189)

- Home reads `GET /daily/summary?limit=14&to=<local YYYY-MM-DD>` and a bounded 30-day `GET /activities` recap. The most recent persisted score is explicitly dated and never relabelled as today's when today's row is absent. Current-day rows are marked incomplete. Category contributions come from the API, including negative and unattributed values.
- Daily reads recent saved days with cursor-style date-only pagination (`to=<oldest date minus one day>`), permits stepping through exact local-calendar days, and opens nested `DailyDetail` for a persisted row only. Detail reads `GET /daily/:date/score-breakdown` after confirming a saved summary row, and whitelists only numeric scores, facts, source classifications and ledger metadata into React state. All three read-only API envelopes are runtime-validated and projected to minimal native view records; unexpected/malformed responses fail closed. Full import/source records are never logged, rendered or cached.
- Every request uses `SessionProvider.read` with server-derived ownership; 401 purges the mobile session. Focus changes, selection changes and history paging reject stale results. There is no API mutation, implicit provider download, new local scoring algorithm, cached score or offline queue.
- Missing days are not zero days; manually edited and workbook-imported scores retain their own status and source authority. Historical score and rule-ledger differences are not silently reconciled by the phone. Activity feed/detail remains #190; full encrypted/offline lifecycle belongs to #194.

**Local Codex acceptance (deferred to epic QA):** Run `pnpm --filter @sportos/mobile test`, mobile typecheck, and iOS simulator layout/navigation checks, then compare saved scores/facts/ledger and date-only responses against the browser for zero/negative/manual/imported/empty days, DST and timezone changes, delayed responses, logout/401 and network errors. Also check VoiceOver/dynamic type and API/GitHub CI parity. No simulator, native build, live session/Neon or full-suite verification was run by this remote implementation agent.

## Local Codex acceptance (deferred to epic QA)

1. Confirm frozen root install, `expo install --check` / `expo-doctor`, mobile typecheck/unit tests and unaffected Angular/API tests and builds; check native dependency resolution from outside `apps/mobile`.
2. Clean simulator Xcode/Metro build and actual launch on iOS 26/27 SDK (Expo Go does not prove native packaging); verify scene lifecycle, iOS package identifier and intended physical-device signing configuration.
3. Browser sign-in: password/OIDC, web confirmation, PKCE exchange and app scheme callback, expired/replayed/duplicate code rejection, mismatched state, URL-interception attempt, Safari cancellation, and rejected HTTP/unexpected web origins.
4. Verify Keychain session restore after restart, logout online/offline, revoked/expired bearer response and forced private UI teardown on 401; rejected CSRF cookie-bearer mixing, account ownership and wrong-owner read attempts.
5. Exercise VoiceOver tab labels, dark/light and large text, nested back gesture, date controls, contrast and 48pt targets; check background/foreground privacy. The latter privacy work continues in #194.
6. Confirm normal web/API build and deploy paths remain unchanged, including hosted read limitations. No App Store/TestFlight submission or production credentials without maintainer approval.

## Investigation files

`AGENTS.md`, `docs/adr/0011-react-native-expo-ios.md`, `docs/AUTHENTICATION.md`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`, `.github/workflows/ci.yml`, `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/mobile-api.ts`, `apps/api/package.json`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.service.ts`, `apps/web/package.json`, `apps/web/src/app/app.routes.ts`, `apps/web/src/app/web-auth.service.ts`, `spikes/mobile-expo/package.json`, `spikes/mobile-expo/App.tsx`, `spikes/mobile-expo/index.js`, `spikes/mobile-expo/app.json`, `spikes/mobile-expo/README.md`, `spikes/mobile-expo/tsconfig.json`, `spikes/mobile-expo/pnpm-workspace.yaml`; #185–#188, PRs #198–#200.

## Native Activities — #190

The Activities tab uses the existing owner-scoped GET /activities feed, with a 90-day/all-source default, bounded server pagination and filters for date window, sport and exact source. Selecting a row navigates to GET /activities/:id. UI projections whitelist canonical facts, distance-correction effective/recorded totals, server-selected optional metric values and provenance coverage; they discard original/source payloads and internal identifiers. A server 401 tears down the authenticated navigation as before. Stale focus/filter/paging/provider responses cannot overwrite newly selected data. There is no persistent offline activity cache.

Run detail displays canonical pace, heart rate, server-computed best efforts with their exact estimated/calculated method and provider, plus **recorded** Strava/Garmin laps when the user presses View saved laps. Indoor/pool swims show recorded Garmin FIT 25/50m pool length when supplied, timer/elapsed per-length pacing, SWOLF, strokes/rest markers, count completeness, and original-vs-audited corrected distance; incomplete or missing FIT evidence never produces inferred lengths. Rides show speed/terrain and server-selected extras such as power; strength workouts show server Garmin set counts and optional explicit retained exercise sets. Walks retain canonical distance/steps and their no-separate-activity-points note. Sparse/legacy activity displays remain explicit, not invented.

Activity navigation does not call upstream providers or POST endpoints. Read-only enrichment GET checks whether data is cached or linked. **View saved** uses GET on existing retained data only; **Fetch**/**Refresh** buttons perform provider POSTs only after explicit user presses. Strava Fetch is shown only when a Strava link/status supports it. Garmin Fetch is hidden unless the backend advertises the local helper as enabled. Hosted Garmin Fetch is not available without that helper. There is no native distance editing or score modification. GPS route rendering and multi-activity heatmaps remain #191; open-water swimming has no invented pool map or lengths.

## #190 deferred local Codex verification

After the epic implementation, local Codex should run the mobile test suite and TypeScript check, lint/Expo doctor, API and Angular regression coverage, iOS simulator and physical-iPhone checks (narrow screens, VoiceOver, chart gestures, dark mode, offline/401/logout, race conditions). Compare all five major sports against canonical browser API responses, audit FIT pool completeness/25m/50m/partial laps, route visibility (after #191), corrected swim distance and genuine provider coverage. Exercise hosted Strava View/Fetch vs blocked Garmin helper, current/stale rich-version handling, and account non-owner UUIDs. **None of these local/device/live validations was run by the remote implementation agent.**
