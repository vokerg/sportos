# Native build and simulator QA (#195)

Inspected: baseline operational/security/architecture docs and ADR 0011; native
package/app/Metro/auth/navigation/screens and README; shared mobile client; API
main/auth/controller/guard and browser approval UI; Expo Doctor and Xcode/simulator
inventory; sibling PCE mobile session/appearance/native-auth patterns. Feature
investigations are recorded separately in issue-191 through issue-194 notes.

Agent-owned scope: reproducible Expo development and release configuration,
explicit HTTPS release origin gate, opaque code-native app icon/splash, local
PKCE/read/revocation smoke tooling and combined simulator verification. No Apple
team/project registration, paid service, signing identity or EAS submission is
configured. `eas.json` is a proposed build configuration, not distribution consent.

Local commands:

- `pnpm mobile:smoke`: local .env bootstrap, real one-use PKCE exchange, six bounded
  canonical reads, native logout/revocation denial. Prints aggregate assertions
  only. Credentials/payloads remain in memory. Requires a local development API.
- `pnpm mobile:smoke -- --browser`: one-use 120-second loopback Safari bootstrap
  at localhost:4310/bootstrap; server-side development token never enters browser
  content. This allows testing actual cookie+CSRF browser approval in local dev
  mode. Not shipped as an API/authentication endpoint.
- `node scripts/mobile-icon.mjs`: deterministic native branding asset generation.
- `pnpm --filter @sportos/mobile run doctor`, `test`, `typecheck`.
- `pnpm --filter @sportos/mobile ios`: native simulator development build.
- `pnpm --filter @sportos/mobile build:ios:local`: embedded Release build, requiring
  explicit HTTPS API/web origins. Release cannot use the localhost exception.

First native MapLibre build passed on Xcode 26.6 / iPhone 17 Pro / iOS 26.5.
Final combined validation is in progress; do not infer a physical-device pass.

Human-controlled gate: select Apple Developer team, approve bundle ID/signing and
entitlements, verify physical-device browser login/Keychain/revocation, VoiceOver,
large text, maps/privacy/battery, approve privacy declarations and export-encryption
answers, then decide TestFlight invitations/submission. The proposed app uses only
platform TLS/Keychain encryption. Validate that exemption with the actual archive
before distribution. No Apple Health/widgets/notifications are included.

Hosted limitations: Render cold starts may require retry after a bounded timeout;
no hosted worker/durable upload-store completion is asserted. Reads disclose missing
retained detail/history and never start historical catch-up or provider requests.
Explicit per-activity provider actions remain server-availability gated. A rollback
is installing the previous signed version and revoking affected server sessions;
canonical data/schema/scoring is not migrated by installing this app.

Local follow-up evidence: final branded development-client build installed/launched
with zero errors (two generated-toolchain warnings: duplicate libc++ and the Expo
Dev Launcher script dependency-analysis warning). Explicit splash dismissal fixes
an observed native startup cover. Production Hermes export succeeded with explicit
hosted HTTPS origins. All repository typecheck/tests/build passed before the last
focused simulator fixes; focused mobile tests passed again afterwards. Live smoke
now exercises native projections, sport details and the real `/map` route as well
as PKCE replay/revocation. V142 fresh migration and five isolated non-owner DB tests
passed. Native URL tests exercise the actual installed React Native polyfill.

Visual observations completed: real browser approval and native Home, Daily detail,
activity feed/run detail, GPS route and bounded heatmap. Run Lab/analytics/offline/
large-text/manual device scenarios remain explicitly tracked until exercised.
No private screenshots, GPS, source records, account material or tokens are committed.
One-use browser helper defaults to port 4311; ASWebAuthenticationSession local-HTTP
cookies can be separate from ordinary Safari. Local QA initialized the approval
browser's own session; temporary QA UI/diagnostics were removed before commit.
