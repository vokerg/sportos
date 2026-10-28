# ADR 0011 — SportOS React Native / Expo client

Status: accepted stack; native simulator build and core runtime validated locally
on 2026-10-28. Personal-device installation and refresh remain owner-managed.
Tracks: #185–#195. Apple Health #196 and widgets/notifications #197 are separate,
explicitly deferred maintainer decisions.

## Decision

Use React Native + Expo + TypeScript in `apps/mobile`, alongside the independent
Angular web client. The existing NestJS API, canonical data, deterministic domain
logic and account/RLS boundary remain authoritative. Do not substitute Capacitor,
Ionic or SwiftUI, import DOM-only Angular/ECharts/MapLibre UI, connect directly to
Neon/providers or implement a mobile scoring engine.

The current app uses Expo SDK 57, React Native 0.86.3, React 19.2.3 and mobile-only
TypeScript 6.0.3. Root backend/Angular TypeScript stays independently configured.
Root pnpm workspace and lockfile include mobile. The disposable `spikes/mobile-expo`
fixture is historical feasibility evidence, not production authentication/data.

## Authentication and privacy

The browser uses existing password/OIDC identity, then explicitly approves a
five-minute one-use server PKCE handoff. The native client verifies exact web
origin/path/parameters and callback scheme/state before exchanging the code.
Revocable `smo_` sessions live in origin-scoped iOS Keychain, never AsyncStorage,
URLs, logs or app configuration. Foundation unscoped keys require fresh sign-in.
Mobile requests omit browser cookies and refuse redirects. Browser cookie CSRF
and native bearer authorization remain distinct; neither selects an owner.

V142 limits handoff control-plane access to the API role. Real bearer validation
and revocation also apply in local dev-single-user mode. Browser native approval
requires a real cookie/CSRF session even when ordinary local browser reads use the
fixed-account convenience mode. Local test bootstrap tooling is not an app/API
production login route. ASWebAuthenticationSession local HTTP cookies may be
separate from ordinary Safari; use its own session or normal HTTPS login.

Private data/GPS is held in memory only. Reads have 30-second deadlines; explicit
operations have 120. Focus/background cancellation and response-generation guards
reject late results. Background hides private navigation; resume revalidates before
remount. 401/logout removes access. No offline mutation queue or unencrypted
private-data cache is supported. iOS app-switcher blur is enabled without health,
photo, location or notification permission requests. Foreground iOS screenshots
remain user-controlled; physical privacy/performance needs device acceptance.

## Presentation and native libraries

Five tabs: Home, Daily, Activities, Run Lab, More. More opens canonical analytics
and private heatmap. Local-calendar date strings, scalable text, meaningful units,
light/dark palettes, touch targets and explicit loading/empty/offline/error states
are shared primitives. Native SVG charts provide exact numeric alternatives and
preserve null gaps. Scores, rolling windows and rankings come from existing APIs.

MapLibre Native 11.5 and its Expo config plugin provide native route/heatmap layers
in development builds. The alpha Expo Maps path was not selected because this app
needs actual heatmap overlays. Geometry stays in memory; OSM raster attribution is
visible. Tiles disclose viewed tile areas to their provider; GPS/bearer data is not
sent as tile parameters. Recording gaps and source precision remain explicit.
Maps unmount when blurred. Indoor pool swims have no GPS route action.
Phone budgets: 50 heatmap routes, 75,000 points, 15,000 density cells, with truncation
and coverage disclosed. No rich provider fetch happens on map navigation.
See [MapLibre Expo setup](https://maplibre.org/maplibre-react-native/docs/setup/expo/).

## Validation and release boundary

On Xcode 26.6 / iPhone 17 Pro / iOS 26.5, native prebuild/CocoaPods/build/install/
launch passed with the configured scene lifecycle. Simulator testing found and
fixed a persistent splash cover and native URLSearchParams.size incompatibility;
regressions exercise the installed native URL implementation. Real browser PKCE,
authenticated reads and core native/map screens were exercised. Node/unit/mounted
lifecycle tests, Expo Doctor 21/21, repository checks, live projection parity,
production Hermes export and fresh/non-owner PostgreSQL checks supplement that.
Implementation notes separate unperformed manual scenarios from observed results.

`eas.json` proposes reproducible build profiles; release origin checks require
explicit HTTPS configuration. No Apple Developer team, paid credentials,
registration, EAS project, TestFlight submission or distribution consent is
provided by these files. Personal-device validation remains tracked in #195.
The maintainer subsequently
selected personal installation with a seven-day refresh cadence; paid enrollment,
TestFlight/App Store and distribution administration are outside this task.
AltStore is a possible later option, with no setup authorized here. Hosted worker,
durable uploads and full historical catch-up are not implied by native reads.

See [mobile operation and QA](../../apps/mobile/README.md) and implementation notes
for #191–#195. Installing the app does not modify canonical facts, score authority,
rule history or provider sync policy.
