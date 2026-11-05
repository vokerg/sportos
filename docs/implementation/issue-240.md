# Issue #240 — private ChatGPT plugin and remote MCP

## Scope and current status

The maintainer requested a SportOS plugin in ChatGPT, confirmed that it should
point to the existing Render setup, requested repository documentation, and
selected existing SportOS branding. PR #241 implements the required remote
transport/authentication and reproducible private package.

Implementation and the local checks below are complete. The PR remains a draft
pending authorization for squash merge and production activation. V145 has not
been applied to production, Render settings have not changed, and the plugin
has not been created/installed or authenticated in ChatGPT. Do not close #240 or
claim the end-to-end connection works until that live verification is recorded.

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
- `apps/web/package.json`, `apps/web/src/app/app.routes.ts`,
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
- Web approval workflow: **4 passed**; web typecheck/build passed. Architecture
  scan checked **216 source files**, with **8 guardrail tests passed**.
- API typecheck and backend build (API + worker and referenced packages) passed.
- Private package tests: **2 passed**. Generated and inspected both a synthetic
  endpoint fixture and the private target archive outside the repository;
  exact four-file contents, valid JSON, existing 1024px SportOS icon and no
  credentials were confirmed. The source manifest subtitle is within 30 characters.
- `git diff --check` passed.

Not verified: live Render deployment/configuration, production migration,
ChatGPT package ingestion/tool discovery, the actual user's browser login and
consent, ChatGPT's final answer, or browser visual QA. The browser access host
was unavailable. Full GitHub CI must still pass on the final pushed head; local
checks are not a claim that the unrelated full repository matrix ran.

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
