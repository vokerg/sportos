# Native MVP validation and release handoff

## Observed baseline

2026-10-28: Xcode 26.6, iPhone 17 Pro simulator, iOS 26.5. Core native
implementation #186–#194 is merged; simulator feature walkthrough, real PKCE
approval, read/projection parity and revocation smoke passed. No physical-iPhone
or TestFlight acceptance has been recorded. Native Liquid Glass #208 is validated in simulator: all five direct tab touches,
detail/back behavior, final-control clearance and light/dark appearance.

| Area | Existing evidence | Remaining release check |
| --- | --- | --- |
| Authentication | Real browser approval/PKCE, replay denial, native reads, live logout/revocation; isolated non-owner auth/RLS tests | Physical browser handoff, Keychain across force-quit/reboot, expiry/revocation while inactive |
| Canonical features | Home/Daily/activity/run details, retained route/heatmap, Run Lab, Dynamics/Monthly Stats in simulator | Real-device map gestures, long lists and source-specific swim/bike detail |
| Failures | Mounted offline/late restore/401/Keychain failure; bounded request/body cancellation and deadlines | Physical network loss, airplane mode, hosted cold start and recovery |
| Privacy | Memory-only private records, background navigation teardown and resume revalidation; app-switcher protection configured | Actual app-switcher image/lock/unlock behavior; production system logging review |
| Accessibility | Native labels, exact chart alternatives, light/dark and one-step text-size increase | VoiceOver reading/rotor, maximum accessibility text, Reduce Transparency/Motion, keyboard focus |
| Build | Installed simulator development and embedded ad-hoc Release builds; origin/secret/permission audit; hosted browser handoff and cancellation | Full hosted authenticated walkthrough and physical signed archive, signing/privacy/distribution signoff |

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

1. Supply the approved Apple Developer team, signing method and intended bundle
   ID. Review proposed `com.sportos.mobile`, version/build and entitlements before
   device installation. Do not register or purchase anything implicitly.
2. Build with explicit reachable HTTPS API and web origins; insecure localhost
   must be false. Verify the resulting archive contains the intended deployment,
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
9. Review Apple privacy disclosures, encryption/export declaration and retained
   data behavior against the actual archive/dependencies. Approve TestFlight
   audience/submission separately. Record real-device result and signoff in #195.

If acceptance fails, keep distribution stopped, reinstall the previous approved
signed build and revoke affected sessions if necessary. App rollback does not
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
