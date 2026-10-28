# Native lifecycle/security hardening (#194)

Inspected: required baseline docs/ADR 0011; apps/mobile App, package/app/TS config,
auth SessionProvider/native/url policy, navigation, daily/activities screens, UI;
shared mobile-api client/tests; API auth service/controller/guard/tests; web mobile
approval and auth client; sibling PCE session/native-auth/live-refresh patterns.
Reviewed child issue dependencies and merged native work.

- Strict minimal session/callback projection before secure persistence. Reject
  callback credentials/ports and never echo upstream errors. Keychain remains
  WHEN_UNLOCKED_THIS_DEVICE_ONLY. No private data, GPS or offline mutation cache.
- Native requests have 30-second read/120-second explicit operation deadlines,
  cookie omission, redirect refusal and no-store requests. Cancellation spans
  response-body parsing. Screen blur/teardown aborts transport; background aborts
  all private requests. Late restore cannot revive signed-out state.
- Background/inactive unmounts private navigation; resume rechecks the session
  before remount. Offline resume shows an unavailable screen. Absolute session
  expiry removes access. 401 hides private screens even if Keychain removal fails.
- Native iOS app-switcher blur is enabled without permission requests. Android
  uses secure-window capture protection. iOS foreground screenshots remain user
  controlled; real-device snapshot/performance checks remain in #195.
- Local dev-single-user retains normal browser convenience, but native bearer
  credentials now always validate/revoke real sessions. Native browser approval
  requires real cookie + CSRF even in local development. Previously development
  bypass made native revocation tests false positives and blocked approval.
- Removed obsolete newArchEnabled; use SDK-required TypeScript 6 within mobile
  only. Root backend/Angular TypeScript remains unchanged.

Validation: Expo Doctor 21/21 checks; mobile TypeScript; baseline mobile tests;
five mounted React lifecycle tests (background/revocation/offline/late restore/
Keychain failure); shared client tests including deadline/body/blur cancellation,
malformed exchange, callback and secure-removal failures; focused API mobile auth
and guard regressions. Local V142 migration applied for live authentication QA.
First native MapLibre build installed/launched on iPhone 17 Pro (Xcode 26.6,
iOS 26.5); final combined security-module build and live walkthrough follow #195.
No physical-device/signing/TestFlight result is claimed.
