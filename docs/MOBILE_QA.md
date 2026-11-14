# Native MVP validation and personal installation

## Current installation scope

The maintainer chose personal installation with a seven-day refresh cadence.
TestFlight, App Store submission, paid Apple Developer enrollment and distribution
signoff are outside this task and do not block simulator MVP completion. The
owner handles Apple authentication and phone-side installation/refresh.
AltStore Classic is configured; the explicitly authorized private parallel
installation procedure is [IOS_ALTSTORE.md](IOS_ALTSTORE.md). No new entitlements
or changes to Apple signing identities are part of that procedure.

Physical-iPhone checks below remain useful personal-use QA, not a store-release
gate. Record individual results only after exercising them on the actual phone.

## Observed baseline

2026-10-28: Xcode 26.6, iPhone 17 Pro simulator, iOS 26.5. Core native
implementation #186–#194 is merged; simulator feature walkthrough, real PKCE
approval, read/projection parity and revocation smoke passed. Original signed
Release installation/launch and owner visual review were later
recorded in PR #214 (2026-10-29), with further installs in #216–#219. These do not
establish the remaining authentication/privacy/refresh scenarios. Native Liquid
Glass #208 is validated in simulator:
all five direct tab touches, detail/back behavior, final-control clearance and light/dark appearance.

| Area | Existing evidence | Remaining personal-device check |
| --- | --- | --- |
| Authentication | Real browser approval/PKCE, replay denial, native reads, live logout/revocation; isolated non-owner auth/RLS tests | Physical browser handoff, Keychain across force-quit/reboot, expiry/revocation while inactive |
| Canonical features | Home/Daily/activity/run details, retained route/heatmap, Run Lab, Dynamics/Monthly Stats in simulator | Real-device map gestures, long lists and source-specific swim/bike detail |
| Failures | Mounted offline/late restore/401/Keychain failure; bounded request/body cancellation and deadlines | Physical network loss, airplane mode, hosted cold start and recovery |
| Privacy | Memory-only private records, background navigation teardown and resume revalidation; app-switcher protection configured | Actual app-switcher image/lock/unlock behavior; production system logging review |
| Accessibility | Native labels, exact chart alternatives, light/dark and one-step text-size increase | VoiceOver reading/rotor, maximum accessibility text, Reduce Transparency/Motion, keyboard focus |
| Build | Installed simulator development and embedded ad-hoc Release builds; origin/secret/permission audit; hosted browser handoff and cancellation | Full hosted authenticated walkthrough and AltStore refresh/update behavior |

Run focused checks with pnpm. Use ignored local environment configuration from
`apps/mobile/README.md`; never place account tokens in Expo public variables.

```sh
pnpm --filter @sportos/mobile run doctor
pnpm --filter @sportos/mobile typecheck
pnpm --filter @sportos/mobile test
pnpm mobile:smoke
pnpm --filter @sportos/mobile ios
```

## Physical-iPhone operator procedure

Use a maintainer-authorized device and account. Record only pass/fail, OS/build,
and sanitized failure descriptions; no activity values, GPS, account IDs,
screenshots containing private content, tokens or provider payloads in GitHub.

1. Use the [AltStore procedure](IOS_ALTSTORE.md), retaining the original app.
   Keep source IPA ID `com.sportos.mobile` and candidate name SportOS AltStore.
   AltStore-managed identity can differ; do not assume original Keychain migration.
2. Build with explicit reachable HTTPS API and web origins; insecure localhost
   must be false. Verify the resulting build contains the intended deployment,
   no debug credentials/local origins and no unintended permission capabilities.
3. Install on the phone. Confirm branded launch, actual system tab bar, all five
   destinations, detail/back navigation and the last button above the bar.
4. Complete system-browser sign-in. Cancel once and retry. Force-quit/reopen,
   background/lock/unlock and revoke the session server-side. Confirm sensitive
   views disappear and fresh approval is required after revocation/sign-out.
5. Exercise each canonical workflow listed above. Check missing GPS, sparse
   achievements and incomplete coverage without fetching provider data implicitly.
6. Lose network while reading and while resuming; verify unavailable/error,
   bounded timeout and manual retry. No cached value should claim freshness and no
   mutation should be queued offline. Repeat against a sleeping hosted API.
7. Inspect VoiceOver labels/order, maximum Dynamic Type, dark mode, Reduce
   Transparency/Motion, safe areas, date-entry keyboard and charts' exact values.
   Inspect app-switcher snapshots, map gestures, memory and battery on real hardware.
8. Confirm canonical facts and score authority remain unchanged by browsing.
   Hosted workers/durable upload storage and historical catch-up remain separate
   limitations. Native UI availability does not establish those operations work.
9. Exercise the owner's seven-day refresh procedure before the personal build
   expires. Check launch, Keychain session restoration and retained server data
   afterwards; sign in again if required. Record observed results in #195. No
   TestFlight/App Store acceptance or public-distribution declaration is required.

If personal-device QA fails, retain all installed apps and investigate. Use a
private recovery IPA through the appropriate installer only after checking identity
and downgrade behavior; do not uninstall to force rollback. Revoke only affected
sessions when necessary and explicitly authorized. App rollback does not
roll back server schema, retained source records or scoring rules.

## Deferred scope

Apple Health #196 and widgets/notifications #197 remain intentionally deferred;
no HealthKit categories, background delivery, new permissions, widget cache or
lock-screen data policy is authorized by this MVP. Historical catch-up #153 and
hosted operations also remain separate from native UI completion.

## Release simulator observations

The embedded Release builds both simulator architectures with the configured
hosted HTTPS origins. Use normal local simulator ad-hoc signing for authentication
checks: `CODE_SIGNING_ALLOWED=NO` produced Keychain failures; ad-hoc signing restored
normal signed-out launch and system-browser handoff. This does not require or
establish Apple Developer/device signing. Cancellation returned safely to sign-in;
production credentials and full authenticated hosted workflows were not exercised.
Direct and proxied hosted health returned healthy after an initial 45-second
startup timeout. Treat retries/cold starts as an actual operator test case.

## AltStore checkpoint (2026-11-14, #253 / PR #254)

**Checked with tools:** AltServer 1.8.4 was running; the paired physical iPhone
was connected over USB, reported iOS 27.0, Developer Mode enabled and DDI available.
Device inventory found AltStore Classic 2.3.3 and PCE AltStore. The original
SportOS was not found in the full preflight inventory; no app was deleted,
deactivated, directly installed or modified by this procedure. Do not infer that
an original app's Keychain/container migrated or was backed up.

The first accepted package uses clean commit
`4c29e5c0f2ed78a2260a51f9be4df081b7c1a9b3` (based on main `61983a3`), version
0.1.0 / build 1794642552. Private location:
`~/Library/Application Support/SportOS/iOS Releases/altstore-PwCXnc/`.
IPA size 12,562,309 bytes; SHA-256
`9ae564f5f497aba37a5523f3d6f2011026a5280f00cb39eb466938f08915519a`.
Physical arm64 Release, embedded Hermes JS (2,657,489 bytes), callback scheme,
label, source bundle ID, version/build, ZIP integrity, local ad-hoc signature,
absent Apple profile/entitlements and payload/private-value checks passed.
Independent digest/size/signature checks matched metadata. AirDrop reported Sent
for the IPA. Apple signing/profile and expiry are produced later by AltStore.

Mobile typecheck and the full mobile test command passed (53 mounted/runtime tests
plus model tests). Three packaging boundary tests, shell syntax and whitespace
checks passed. Expo Doctor: **20/21**, reporting newer patch releases for expo,
expo-build-properties, expo-dev-client and expo-splash-screen; no dependencies
were upgraded. Existing approved API health and web mobile-connect returned HTTPS
200 without changing origin; values were kept private. No backend/DB suites were
needed for this packaging/documentation change; no server/worker was started.

**Checked after import with tools:** device inventory confirms **SportOS AltStore
0.1.0 / 1794642552** is installed. Its managed bundle identifier differs from
`com.sportos.mobile`; the identifier itself stays in private metadata. The device
launch command succeeded. This verifies installation/launch command acceptance,
not the rendered screen, authenticated data or Keychain restoration. The actual
AltStore-issued provisioning profile, entitlement groups and expiry were not
extracted or independently inspected.

**Owner confirmations:** the preflight phone request (USB/unlock, Prefer Remote
off, AltStore/PCE active and available slot) was answered “всё ок”. After AirDrop
the owner could not find the raw IPA in Downloads; a private ZIP containing only
the first IPA was sent instead, with extracted digest checked against release
metadata. Finder reported Sent for both transfers. The owner subsequently replied
“есть вроде” and requested documentation updates. Treat this as tentative appearance
confirmation, strengthened by the independent installed-app inventory above; it
does not confirm login, refresh or session preservation.

A second package was built successfully from the same clean commit for the
higher-build update gate: 0.1.0 / 1794642655, size 12,562,299 bytes, SHA-256
`c8cf914dcc498cae2261af869a66d6681a6c37b9ef9b04649fe818c429e40d05`, under
`~/Library/Application Support/SportOS/iOS Releases/altstore-X8r9EB/`.
It was **not imported**; inventory still reports the first build. Keep it privately
for the next explicitly exercised update check. Preparation is not an update pass.

**Remaining gates:** actual screen rendering, browser approval/login and data,
force-quit session restoration, Refresh All with inspected SportOS/AltStore expiry
changes, and second higher-build import preserving the same managed identity and
session. Remote refresh, coexistence login/generic deep links, original-app
identity migration and unattended weekly renewal remain unverified. No app was
removed, no certificate revoked and no server client registration changed. Next
operator should continue those phone checks using IOS_ALTSTORE.md; do not rebuild
or reconfigure Apple accounts merely to repeat this successful installation.
#195's broader manual matrix stays open; #253 is not closed or merged automatically.
