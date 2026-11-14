# SportOS AltStore Classic personal releases

This procedure creates a labelled **SportOS AltStore** parallel copy. Keep the
original app/data and existing Apple signing identities. Do not uninstall or
deactivate apps, change teams, revoke certificates or bypass OS security prompts.
The original IPA identifier stays `com.sportos.mobile` across releases. AltStore
may rewrite it and Keychain groups; the same Apple ID does not prove an in-place
update of an Xcode installation. A new copy can require a fresh login.

## Build privately on the Mac

Use the current SportOS requirements: Node 22.22+, pnpm 9.12, full Xcode 26.4+
and CocoaPods; the observed workstation uses Node 22.23.3 / Xcode 26.6.
Inspect `git status`, current main, issue/dependencies and PRs first. Record the
chosen revision explicitly; never silently pull/switch revisions to build.

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH" # use your installed Node 22 path
pnpm install --frozen-lockfile
# Existing ignored native workspace must match current app/plugins/dependencies.
# If absent or native dependencies changed (this generates ios/ and runs CocoaPods):
# pnpm --filter @sportos/mobile exec expo prebuild --platform ios
# Review ios/.xcode.env.local after generation; it must use this same Node 22.
printf 'export NODE_BINARY=%s\n' "$(command -v node)" > apps/mobile/ios/.xcode.env.local
# Create apps/mobile/.env.altstore manually from the approved public HTTPS origins.
chmod 600 apps/mobile/.env.altstore
pnpm --filter @sportos/mobile typecheck
pnpm --filter @sportos/mobile test
node --test scripts/ios/altstore-release.node-test.mjs
./scripts/ios/altstore-release.sh
```

The ignored `.env.altstore` contains only `EXPO_PUBLIC_SPORTOS_API_URL`,
`EXPO_PUBLIC_SPORTOS_WEB_ORIGIN`, and `EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST=false`.
Origins must be exact HTTPS origins without path, userinfo or credentials. Verify
API `/health` and browser `/mobile-connect` against the existing deployment without
printing private origins. Root `.env`, service credentials and inherited secrets
are excluded from the child environment; Expo dotenv loading is disabled. Never
copy PCE public settings or versions into SportOS.

The script builds arm64 **Release** with embedded JS; no Metro server, API,
worker or scheduler starts. It sets the candidate name/version/build in a private
input plist before compilation/signing. Build numbers increase over prior private
release metadata. The app receives a local **ad-hoc integrity signature**, with
no Apple team or provisioning profile: this is an input for AltStore re-signing,
not a directly installable Apple-provisioned release. AltStore supplies the actual
Apple certificate/profile for the device during import. No direct installer is
provided. Check actual phone-side signing expiry separately.

Artifacts are mode-restricted beneath
`~/Library/Application Support/SportOS/iOS Releases/altstore-*/` (directory 0700,
files created under umask 077): IPA, `build.log`, `signature.txt`, input plist,
`release.json`, `source-status.txt`, `source.patch`, and packaged signed app.
`BuildCache/` beside them holds reusable private Xcode DerivedData. Each successful
release retains its own packaged app; the cache can be rebuilt. Keep recovery IPAs
and metadata; never commit/upload binaries, raw logs, signing/device metadata or
private infrastructure. Build is repeatable, not byte-identical. Metadata records
commit, dirty state, version/build, size, SHA-256 and pre-import signature state.
Commit source changes first when possible; preserve dirty diffs privately otherwise.

Validation checks signature integrity, arm64/iPhoneOS, name/ID/version/build,
callback scheme, embedded JS and intended origins, transport/privacy settings,
empty native entitlements and absent Apple profile, ZIP structure and unexpected
service/private files/credential patterns. These checks supplement source review;
they do not prove arbitrary hardcoded secrets are absent. Any failure keeps logs
private and stops before transfer. Do not share an IPA from an incomplete run.

## Private transfer and first installation

1. Verify local AltServer is the official `/Applications/AltServer.app`, running;
   the observed version is 1.8.4. Unlock/trust the USB-connected iPhone. Do not
   reinstall AltStore unless recovery requires it.
2. In AltStore Classic Settings, check **Prefer Remote AltServer** is off for this
   local procedure. Check available active-app capacity: a free account permits
   three including AltStore. AltStore + PCE + SportOS fill those slots. An original
   free-signed Xcode app can also affect device limits. Stop on a limit; never
   remove/deactivate another app automatically. Avoid new randomized IDs.
3. Check IPA digest and size against private `release.json`. In Finder, select the
   IPA → Share → AirDrop → owner's iPhone. Owner accepts it and saves to Files.
   If raw IPA AirDrop does not appear in Files, wrap only the IPA in a ZIP:
   from the private release directory run `python3 -m zipfile -c
   SportOS-AltStore-transfer.zip SportOS-VERSION-BUILD.ipa`. Verify the ZIP contains
   only that IPA and its extracted SHA-256 matches release.json. AirDrop the ZIP,
   choose Save to Files in an explicit folder (for example On My iPhone), tap the
   ZIP to extract, then select the extracted IPA in AltStore. Raw IPA delivery can
   show Sent without leaving a discoverable file in Downloads; do not infer import.
   No public hosting, GitHub Releases, LAN HTTP server or remote upload is used.
4. On iPhone open **AltStore → My Apps → +** and choose the IPA from Files.
   This enrolls it for AltStore refresh. Xcode/devicectl installation does not.
   Owner enters Apple ID/password/2FA only in Apple/AltServer/AltStore UI. Stop at
   certificate revocation or identity-changing prompts; retain existing apps.
5. Verify **SportOS AltStore** appears in My Apps and on the phone, launch it,
   complete browser login/approval, check server-backed data, then force-quit and
   reopen to verify session restoration. Record pass/fail only, no personal data.
   Tool inventory/launch success alone does not establish authentication.

## Authentication and two copies

SportOS uses `sportos://auth/callback`, a one-use PKCE handoff and Expo
`openAuthSessionAsync`. The installed SDK57 native code uses
`ASWebAuthenticationSession` with callback scheme `sportos`; [Apple's session
contract](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession)
returns the callback to the initiating authentication session even with shared
schemes. Verify this on the actual candidate. Generic external `sportos://` links
can resolve ambiguously with two installed copies; do not use them for cutover.
No backend client registration change is required by this procedure. Keychain
sessions are origin scoped and `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; backup or same
Apple ID is not proof of transfer between identities. Keep the original copy.

## Renew signing, update code, recover

**Refresh All renews signing.** Open AltStore My Apps → Refresh All before expiry;
verify newly issued expiry information for SportOS and AltStore, and open SportOS
afterwards. Keep local AltServer reachable and Mac awake over USB or the same
Wi-Fi. Check local network/Background App Refresh permissions when needed.
[AltStore documents](https://faq.altstore.io/altstore-classic/your-altstore) seven-day
expiry and background refresh attempts. One manual success does not demonstrate
unattended weekly renewal; inspect expiry regularly and keep a manual routine.

**A new IPA updates code.** Build the explicitly chosen new revision, use the same
original IPA bundle ID and candidate name, and a higher build number. AirDrop →
Files → My Apps + again with the same AltStore account. Verify the same managed
copy updates, its build changes and login survives force-quit/relaunch. Do not
claim update/session preservation until this second import actually succeeds.
There is no configured private update feed or Expo OTA service.

Remote mode is separate and unverified here. The previous PCE attempt reported
“couldn't reach the remote AltServer”; use local USB and Prefer Remote off for
this task. [Official remote instructions](https://faq.altstore.io/altstore-classic/remote-altservers)
require pairing, Wi-Fi and LocalDevVPN. Do not send private IPAs to an unreviewed
remote service or treat local refresh as proof of remote operation.

If AltStore expires, recover it with local AltServer and the same Apple account,
without first deleting apps, then refresh managed apps. Stop repeated login
attempts on HTTP 429; no cooldown duration is established. Owner handles Apple
authentication and certificate confirmations. For reachability errors, inspect
USB/trust/unlock, local server, network permission and Prefer Remote setting.
For signing/app-slot errors, retain all apps and report the exact sanitized error.
For a code regression, import a retained recovery IPA only after checking identity
and AltStore's downgrade behavior; do not uninstall to force rollback. Server
schema and canonical records are not rolled back by installing an app.

## Evidence and remaining gates

See [mobile QA](MOBILE_QA.md) for observed results. Report separately: instrument
checks, owner confirmations, and unverified scenarios. Remaining broader #195
checks include reboot/expiry/revocation, app-switcher privacy, accessibility,
network failure, maps/long lists and performance. Personal installation does not
establish those checks or hosted worker operation.

Current checkpoint: device inventory and launch command confirm installed
SportOS AltStore 0.1.0 / 1794642552 (2026-11-14). The higher-build candidate
1794642655 is prepared privately but has not been imported. Continue phone login,
cold-relaunch, expiry/Refresh All and same-copy update gates from MOBILE_QA.md;
do not interpret installation as their completion.
