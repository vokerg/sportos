# Issue #240 — private ChatGPT plugin and remote MCP

## Scope and current status

The maintainer requested a SportOS plugin in ChatGPT, confirmed that it should
point to the existing Render setup, requested repository documentation, and
selected existing SportOS branding. PR #241 implements the required remote
transport/authentication and reproducible private package.

The requested connection is live and verified on 2026-11-06. PR #241 was
squash-merged as 58f87ea after CI and explicit maintainer approval. Production
V145 applied successfully. PR #242 fixed the observed ChatGPT locale hint and
registered-App packaging, passed all CI jobs and was squash-merged as 2f087bb.
Render deployed the fixes; the separate MCP origin is enabled.

The private SportOS package is version 0.1.1, bound to the verified registered
SportOS MCP App. Fresh browser approval, the issuer-identified OAuth callback and
an actual bounded ChatGPT training-volume read succeeded. The connection is left
active for the user. No private training values, prompts, generated personal
content, credentials or account-specific plugin/App IDs are included here.

## Investigation before implementation

Current `main` was `44f110a`; the worktree was clean. Reviewed open issues and
PRs, including recent merges #234–#239; no issue or active PR owned this work.
Issue #240 and its `CLAIMED` comment were created before implementation on
`issue-240-chatgpt-mcp-plugin`; draft PR #241 was opened early.

Files inspected:

- `AGENTS.md`, `README.md`, `package.json`, `.env.example`, `.gitignore`,
  `tsconfig.base.json`, `.github/workflows/ci.yml`;
- `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/AUTHENTICATION.md`,
  `docs/AI_ANALYSIS.md`, `docs/FRONTEND_ARCHITECTURE.md`, `docs/ATHLETE_MCP.md`,
  `docs/DEPLOYMENT.md`, ADRs 0005 and 0007;
- `apps/mcp/package.json`, `apps/mcp/src/main.ts`, `runtime.ts`, `server.ts`,
  `library.ts`, `service.ts`, `contracts.ts`, `server.test.ts`,
  `service.integration.test.ts`, `retained-laps.integration.test.ts`;
- `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/main.ts`,
  `app.module.ts`, `db.provider.ts`, `hosted-config.ts`, `cors-options.ts`;
- `apps/api/src/auth/auth.service.ts`, `auth.controller.ts`, `auth.models.ts`,
  `public.decorator.ts`, `session.guard.ts`, `session.guard.test.ts`,
  `mobile-auth.test.ts`, `single-user-auth.test.ts`;
- `apps/api/src/chat/chat.service.ts`, `chat-evidence.ts`, `chat.test.ts`;
- `apps/web/package.json`, `apps/web/src/app/app.routes.ts`, `app.routes.test.ts`,
  `mobile-connect.component.ts`, `web-auth.service.ts`,
  `daily-detail-page.component.test.ts`,
  `features/mobile-auth/data-access/mobile-connect-api.service.ts`,
  `features/providers/state/provider.store.test.ts`,
  `features/rules/pages/rules-page.component.test.ts`,
  `features/services/pages/services-page.component.ts`;
- `packages/db/package.json`, `packages/db/src/schema.ts`, `index.ts`, `pool.ts`,
  `repositories/auth.repository.ts`, `repositories/mobile-auth.repository.integration.test.ts`;
- all 53 existing primary migration files through V144 were inventoried/read
  for migration ordering and security statements; V106/V108 authentication
  constraints and the full V142 handoff migration were examined in detail;
  existing dedicated detail V001 was examined when preparing its disposable
  test database;
- `scripts/flyway.mjs`, `scripts/check-web-boundaries.mjs`,
  `scripts/mobile-icon.mjs`, `apps/mobile/assets/icon.png`;
- the installed MCP SDK 2.4.0 package manifest/transport declarations and the
  Plugin Creator packaging/server-access/component references.

The documentation distinction relevant to this task: local stdio MCP and
in-memory web Chat do not establish a remotely authenticated endpoint. A direct
read-only probe of the documented Render service's `/mcp` returned 404. The
existing local fixed-account binding is therefore not repackaged as a remote
service. ADR 0005's original OIDC-only sign-in text predates the explicitly selected
single-user mode documented in current AUTHENTICATION.md; this connection reuses
the current sign-in flow. ADR 0007 describes internal generated analysis, not
external ChatGPT prose. Current OpenAI custom-MCP and authentication documentation was read
for public-client PKCE, resource binding and the issuer-identified callback.

## Result and review

The existing API hosts stateless JSON Streamable HTTP and the original five
athlete read tools. Each request resolves the account from an opaque OAuth token;
canonical repositories remain inside existing account context and read-only
transactions. No external generator, new hosting service or provider fetch was
introduced. The generated ChatGPT answer remains outside internal Chat's
citation validator and audit path; the guide states that distinction explicitly.

OAuth uses a fixed public client, exact ChatGPT callback and resource, S256
PKCE, a five-minute one-use code flow, digest-only credentials, session-bound
expiry, and server revocation. MCP tokens cannot authenticate as browser/mobile
sessions or use ordinary API routes. Browser consent/disconnect require real
cookie sessions and CSRF even in development bypass mode. V145's new control
plane is forced-RLS API-only, has a same-account session FK and immutable
request/approval/token bindings, and asserts runtime-role restrictions.

The route-scoped Angular store cancels stale requests, prevents repeated
approval clicks, validates the fixed callback and provides a manual Return to
ChatGPT action. Services links to account revocation. The private package uses
the existing icon; its generated endpoint configuration and ZIP stay outside
Git. Packaging checks reject ambiguous/insecure origins, tracked output and
archive reuse, and inspect exact members/JSON after packaging. CI runs those
checks and includes the new non-owner repository integration suite.

Self-review covered the complete diff, routing/CSRF bypass behavior, token
channel separation, code replay/concurrency, account/session FKs and immutable
bindings, data/role isolation, input/output/request limits, generic error
handling, archive contents and deployment-inventory/privacy boundaries. No
canonical/scoring/provider side effects were added.

## Validation on 2026-11-05

- API suite: **273 passed**, four unrelated integration cases skipped without
  their dedicated configuration. Includes 23 new remote OAuth/transport/privacy
  cases and existing browser/mobile authentication regressions.
- MCP suite: **16 passed**, including six primary-database and one dedicated
  detail-database integration cases, plus independent stdio client smoke.
- New MCP OAuth repository integration: **6 passed** under non-superuser,
  non-owner `sportos_app`, with two synthetic owners. Checks exact bindings,
  concurrent approval/exchange, replay, cross-owner reads/session FKs,
  reassignment/credential immutability, expired/revoked/disabled states and all
  worker/legacy/shared privilege denials.
- Fresh Flyway: **54 migrations through V145 passed** in disposable loopback
  PostgreSQL 16. Populated V144→V145 upgrade also passed and preserved a
  synthetic pre-existing account/session and token digest. No production or
  existing development database was migrated.
- Compiled Nest API over real loopback HTTP: metadata, unauthenticated challenge,
  real cookie/CSRF approval, URL-encoded PKCE token exchange, replay denial,
  five-tool discovery, successful deterministic volume read, rejected unknown
  fields, rejection on ordinary authenticated API routes, and disconnect followed
  by read denial all passed with disposable databases and synthetic sessions.
- Web suite: **396 passed across 72 files**, including four approval workflow
  cases and the updated route-list assertion; web typecheck/build passed. Architecture
  scan checked **216 source files**, with **8 guardrail tests passed**.
- API typecheck and backend build (API + worker and referenced packages) passed.
- Private package tests: **2 passed**. Generated and inspected both a synthetic
  endpoint fixture and the private target archive outside the repository;
  exact four-file contents, valid JSON, existing 1024px SportOS icon and no
  credentials were confirmed. The source manifest subtitle is within 30 characters.
- `git diff --check` passed.

At the initial implementation checkpoint, live Render activation, package
ingestion, actual browser consent and a ChatGPT read were not yet verified;
the completed results are recorded below. The browser access host
was unavailable; a native Chrome fallback later reached the existing Render
dashboard through routine GitHub sign-in, without changing settings. The first full GitHub run caught the existing route-list assertion missing the
new consent route; that test was updated. Full GitHub CI must still pass on the
final pushed head; local checks are not a claim that the unrelated full repository
matrix ran.

## Activation handoff

Follow [CHATGPT_PLUGIN.md](../CHATGPT_PLUGIN.md) for exact operator steps and
rollback. Obtain explicit squash-merge/production authorization under
`AGENTS.md`, apply V145 with the separate migration identity, deploy the existing
API and frontend, set the separate direct MCP origin on Render, verify metadata
and the 401 challenge, then create one private SportOS plugin from the inspected
archive. Install/approve and perform one bounded read; verify revocation before
recording completion. Keep returned plugin/release IDs and deployment inventory
in private operations notes. Update this record and close #240 only after the
requested live connection is verified.

## Authorized activation record

On 2026-11-05, explicit maintainer approval covered squash merge, production V145,
Render activation and private plugin creation. CI run 42090510156 passed build,
disposable Garmin integration and Linux worker packaging. Its Neon-secret-dependent
gates were skipped because those CI secrets are not configured; local disposable
MCP database evidence above remains the direct validation for this migration.

PR #241 was squash-merged as 58f87ea. Primary production migration advanced from
V144 to V145 with all checksums validated; no canonical/scoring data migration was
involved. The existing Render service automatically built the merge, and the
separate non-secret MCP public-origin setting was saved through the dashboard.
The existing Vercel-proxied API origin, runtime roles, credentials, encryption keys,
storage and worker topology were preserved. Deployment/live connection verification
is ongoing.

### Live host compatibility and App binding

ChatGPT's actual authorization request included `ui_locales=en-US`. The strict
allowlist rejected that standard UI hint before writing any grant. PR #242
accepts bounded language-tag lists without retaining them or changing the
client/resource/scope/PKCE/owner binding; malformed hints and unknown fields
still fail closed. Twenty-four focused OAuth/transport cases, API typecheck and
three packaging cases passed. CI run 42093425646 passed all three jobs, and the
authorized fix was squash-merged as 2f087bb. Its Render deployment subsequently succeeded.

A standalone raw-MCP archive was saved as a private SportOS package, but web
ChatGPT needed a registered MCP App connection. One private SportOS MCP connection
was registered using the discovered exact callback, public client auth `none`,
PKCE, resource and only `athlete:read`. The original branded SportOS package was
updated in place to version 0.1.1 with that verified App dependency. Read-back
confirmed the App binding, icon, skill, prompt order, private audience and absence
of obsolete direct MCP declarations. No additional standalone package was created
to refresh tools. OAuth completion/read verification subsequently passed as recorded below. Account-specific IDs and archive configuration remain
outside the repository.

### Completed live verification — 2026-11-06

- The existing Render service deployed 2f087bb. Protected resource and
  authorization-server metadata return the exact configured issuer/audience.
  Anonymous POST `/mcp` returns 401 with its resource-metadata challenge and
  `no-store`; the Vercel API health proxy also returned 200.
- ChatGPT registered the existing endpoint with static public client
  `sportos-chatgpt`, token endpoint auth `none`, the stable exact callback and
  only `athlete:read`. No password or token was extracted into a tool or file.
- An old five-minute request was replaced through **Continue connecting app**.
  A fresh authenticated SportOS consent showed read-only access, approval
  succeeded, and **Return to ChatGPT** completed the callback. The connection
  entry then displayed **Manage** with no pending Connect action.
- **Try in chat** selected the registered SportOS MCP connection. A bounded
  completed-week running-volume request executed in a real ChatGPT conversation;
  its tool trace displayed the completed volume operation and the answer
  acknowledged verification. The test requested no personal numbers or activity
  details in its displayed answer. Neither question/answer content nor evidence
  values were copied into GitHub or tracked files.
- The original branded package was read back after its in-place 0.1.1 update:
  verified App dependency, retained icon/skill/prompts/private audience, no raw
  `mcp.json` or generated `.mcp.json` duplicates. Registered connection and branded
  skills package are separate host components, not replacement packages.
- Live revoke/reconnect was not repeated after this success; the working
  connection remains active. Revocation, expiry, replay and cross-owner isolation
  were proven in the local HTTP and non-owner database integration evidence above.

The final documentation update is limited to the setup guide and this record.
Validation: link, diff and privacy checks; no unrelated heavy suites were rerun.
Future reconnects reuse the existing private App and package; credentials remain
inside ChatGPT's connection flow and SportOS's digest-only control plane.
