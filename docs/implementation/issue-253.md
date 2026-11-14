# Issue 253 — SportOS AltStore personal installation

Explicit maintainer request, narrow follow-up to #195. Branch starts at current
main `61983a3`; initial checkout was clean `dc82563`, one commit behind. No app
source revision was silently substituted. Draft PR #254 was opened early; no
merge authorization has been given.

Inspected before implementation: AGENTS.md; README.md; docs/ARCHITECTURE.md,
ROADMAP.md, AUTHENTICATION.md, AI_ANALYSIS.md, MOBILE_QA.md; ADRs 0007/0011;
implementation notes 195/208/213/215/217/219; apps/mobile README/package/app config,
app.json/eas.json/metro.config.cjs/index.js; auth/native.ts and url-policy.mjs;
release-config tests; ignored native project, Info.plist, entitlements and Xcode
Node configuration. Reviewed open issues/claims/PRs, recent merges and main.
Read PCE personal-release documentation, scripts/ios release helper/tests/source
mechanism and PR #200 as reference only; no PCE changes. Also inspected installed
SDK57 WebAuthSession.swift and official Apple/AltStore documentation linked in
the runbook. During implementation inspected native build logs privately,
compiled payload/Info.plist, signature, framework/Metro asset layout, device
inventory and readiness (metadata remains private).

Documentation mismatch: README/QA denied physical installation, although #195,
PR #214 and subsequent implementation notes already recorded signed-device
installation. Earlier no-AltStore-authorization guidance is superseded by this
explicit task. Corrected mobile README, QA and ADR link, with AGENTS pointer.
Unrelated roadmap/operations mismatches remain outside scope.

Implementation: a SportOS-specific pnpm/Node22/Xcode Release wrapper, fixed source
IPA identity, labelled parallel app, monotonic builds, private audit metadata and
payload checks. Xcode requires provisioning even for its ad-hoc device target;
compile the import artifact without Xcode provisioning, locally sign/verify code
ad-hoc, and leave mandatory Apple signing to AltStore. No direct install command,
certificate/team mutation or OS security exception. SDK57 ASWebAuthenticationSession
uses sportos callback; generic external deep links remain ambiguous with two copies.

First compile succeeded but a conservative node_modules guard rejected Metro's
PNG resource paths. The final guard permits only PNG files with PNG signatures
under assets/__node_modules, still rejecting service code, secret files and
symlinks; a regression covers that distinction. The ignored generated Xcode Node
override pointed to Node26 and was aligned to installed Node22 before final
bundling; the helper now rejects mismatched overrides. Final clean-build evidence,
private artifact references, owner reports and remaining gates are in MOBILE_QA.md.

Self-review: source/runtime auth/scoring/provider/server contracts unchanged;
no new permissions, account registration, binary publication or scheduled service.
Private artifact metadata and source status/diff stay outside Git. The full diff and phone evidence were reviewed; installation/build and device
launch commands passed, while authentication/expiry/update gates remain open; do not close #195 merely
because installation/refresh succeeds. No merge without maintainer authorization.
