# ChatGPT plugin on the existing Render API

Issue #240 adds a remote read-only connection to the existing SportOS API.
The local stdio server in [ATHLETE_MCP.md](ATHLETE_MCP.md) and the in-app
[Chat](CHAT.md) remain available. No new hosting service or model gateway is
needed: ChatGPT calls the Render API directly and handles the conversation.
The SportOS API does not receive or persist the chat transcript.

## Status

**Live and verified on 2026-11-06.** PRs #241 and #242 were squash-merged
after their three CI jobs passed. Production V145 is applied, and the existing
Render API serves authenticated MCP with the separate public-origin setting.
The existing browser API origin and credentials are unchanged.

The private SportOS package is version 0.1.1 and reuses the registered SportOS MCP
App connection. Browser consent and the OAuth callback completed successfully.
A real ChatGPT chat invoked a bounded retained running-volume read and returned
its verification acknowledgement. Personal values and generated personal content
were not copied into this repository or GitHub. The connection is left active.

To use it, open the private **SportOS** plugin, connect its **SportOS MCP**
dependency if prompted, and choose **Try in chat**. In a chat, select
**@SportOS MCP** for the verified tool connection. Access expires after at most
twelve hours or earlier browser-session expiry/sign-out; reconnect when prompted.
Live revoke/reconnect was not exercised after the successful read so the working
connection remains available; revocation and expiry passed local HTTP/database
integration tests. See the implementation record for the precise evidence.

## Tools and privacy boundary

| Tool | Retained evidence |
| --- | --- |
| `get_athlete_snapshot` | Broad deterministic run/bike/swim overview and coverage |
| `get_training_volume` | Bounded calendar totals and daily/weekly/monthly/annual buckets |
| `get_personal_bests` | Supported run distances or whole bike/swim activities |
| `search_activities` | Allowlisted filters, bounded pages and canonical activity identifiers |
| `get_activity_details` | One canonical activity, compact metrics and retained current laps |

Schemas and limitations are those of `apps/mcp/src/contracts.ts` and
[ATHLETE_MCP.md](ATHLETE_MCP.md). No scores, writes, imports, provider downloads,
SQL, arbitrary filters, raw payloads, routes or narrative are added by this
connection. The model cannot select an owner. Missing retained history does
not establish rest or provider completeness. Official deterministic evidence
and generated interpretation must remain visibly distinct.

These are direct tool results, not the internal web Chat generation flow:
SportOS cannot validate ChatGPT's final prose or enforce its citations after
returning evidence. The packaged skill instructs ChatGPT to cite real returned
identifiers and preserve deterministic values, units and coverage limitations.
Internal Chat's citation validation and `analysis_runs` audit are unchanged;
remote reads do not create analysis answer audits. Do not enable HTTP body,
Authorization header, OAuth query or tool-result logging on the API or proxy.
ChatGPT receives the explicitly approved training evidence and may retain it
under the user's ChatGPT account/workspace settings.

## Authentication

The API is both the MCP protected resource and a narrow OAuth authorization
server. This is separate from SportOS's upstream OIDC identity provider.
Single-user deployments use their existing SportOS password form; OIDC
installations use their existing identity login. No SportOS password or database
credential is entered in ChatGPT or packaged with the plugin.

- The fixed public client is `sportos-chatgpt`, with token endpoint auth `none`.
  No client secret, client credentials grant, DCR or CIMD is supported.
- The only scope is `athlete:read`. The exact resource is
  `https://<render-api-host>/mcp`, without trailing slash.
- The callback is exactly
  `https://chatgpt.com/connector_platform_oauth_redirect`.
  Metadata advertises RFC 9207 issuer identification, and successful callbacks
  include the exact issuer in `iss`. No arbitrary redirect URI is accepted.
- Authorization requires a nonempty bounded state, S256 PKCE, exact client,
  redirect, scope and resource. It creates a five-minute request and sends the
  browser to the existing frontend's `/mcp-connect` route.
- The authenticated shell presents explicit consent. Approval is a browser
  cookie + session-bound CSRF POST; mobile bearer credentials and development
  bypass cannot approve. The account comes only from the real session.
  The user then clicks **Return to ChatGPT** to finish the OAuth callback.
- The one-time code exchange binds all of the above fields and atomically
  issues an opaque `smc_` access token. Only its SHA-256 digest is retained.
  Concurrent or replayed exchanges fail. There is no refresh token. Access
  lasts at most twelve hours, bounded by the approving session's current idle
  and absolute expiry; signing out, disabling the account or revoking the grant
  stops access. Reconnect through sign-in when it expires.
- Every `/mcp` request authenticates again. Browser cookies, mobile tokens,
  mixed credentials and Origin-bearing browser calls are rejected. MCP tokens
  cannot authenticate to ordinary SportOS API routes, including mutations.
- **Services → ChatGPT → Revoke all ChatGPT access** revokes this account's
  grants with the normal browser session/CSRF protections. Disconnecting inside
  ChatGPT can also call the token revocation endpoint. Removing a plugin is not
  a substitute for server revocation if the host does not send that request.

V145's `mcp_oauth_grants` is an explicit API-only authentication control-plane
exception, like `mobile_auth_requests`: requests exist before an account is
known. Forced RLS permits only `sportos_app`. It holds bounded state/challenge,
client/resource/redirect bindings and digests, never training data or plaintext
codes/tokens. A composite FK binds approval to a session of the same account.
Triggers prevent reassignment and changes to request/token bindings. Worker,
worker-data, legacy and shared roles receive no access. Expired pending and
expired token grants are removed on subsequent authorization requests.
Canonical reads still use `AthleteReadService` account context, read-only
repeatable-read transactions and existing database/response bounds.

## Render deployment

Preserve the existing service, database roles, password/OIDC configuration,
Vercel proxy, storage and worker topology in [DEPLOYMENT.md](DEPLOYMENT.md).
Do not change `SPORTOS_API_ORIGIN`: existing browser/provider callbacks still
use the Vercel `/api` proxy. The new public MCP origin is separate.

After explicit authorization:

1. Apply primary Flyway V145 with the separate migration identity. Test the
   schema state first. There is no activity-detail migration in this change.
   Do not supply migration credentials to Render or ChatGPT.
2. Deploy the reviewed PR's API and frontend from `main` using the existing
   build/start commands. Their order is compatible while remote MCP is disabled.
3. In the Render API service, set the new non-secret variable:

   ```dotenv
   SPORTOS_MCP_PUBLIC_ORIGIN=https://<render-api-host>
   ```

   It must be an exact direct HTTPS origin: no slash, `/api`, `/mcp`, query,
   credentials or fragment. Leaving it empty disables remote metadata and MCP
   routes with 404. Production startup rejects invalid values. Local fixture
   tests alone may use a loopback HTTP origin outside production.
4. Retain `DATABASE_URL` as the non-owner application role and the separate
   activity-detail runtime URL. Do not set the local-only
   `SPORTOS_MCP_ACCOUNT_ID` for this host. No AI API key is required by remote MCP.
5. Verify the public metadata and unauthenticated challenge below. Free Render
   instances may cold-start; distinguish a cold-start timeout from invalid auth.

The remote transport is stateless Streamable HTTP with JSON responses. It does
not need sticky sessions, an extra port, an SSE subscription, or a shared
in-memory account map. Authenticated GET/DELETE `/mcp` return 405; POST is the
supported method. Requests are capped at 64 KiB, with one active request and
30 requests/minute per account, plus a global 20-active-request bound. The OAuth
control plane limits valid start/exchange/revoke requests to 60/minute per API
process. These in-memory limits reset on restart; scale-out would need a shared
limiter. No proxy CORS expansion or anonymous tool discovery is required.

## Register and package the private plugin

For ChatGPT, register the MCP connection first through
[the supported custom MCP flow](https://developers.openai.com/api/docs/guides/custom-mcp-server):
**Plugins → + → Add custom MCP server**. Use name **SportOS MCP**, URL
`https://<render-api-host>/mcp`, OAuth and advanced settings:

- User-defined public client ID `sportos-chatgpt`; no client secret.
- Token endpoint authentication `none`.
- Default and base scope `athlete:read`.
- Discovered issuer/resource/endpoints exactly matching the direct Render host.
- Callback exactly `https://chatgpt.com/connector_platform_oauth_redirect`.

Create the private connection, choose **Connect**, complete SportOS browser
approval and **Return to ChatGPT**. The language hint `ui_locales` is accepted
only as a bounded language-tag list and is ignored before retention; other
unknown authorization fields remain rejected. No authentication downgrade is
needed. If ChatGPT shows a different callback, stop and verify metadata/host
compatibility rather than widening the redirect allowlist.

This produces a registered MCP App and its private connection entry. Use that
same connection for the branded skills package. Read its `.app.json` through
Plugin Creator to obtain the actual backend App ID. Do not invent an ID or
strip a prefix from a plugin URL: the verified App ID is a different identifier.
Keep account-specific IDs in private operations notes, outside Git.

Tracked package source is in `plugins/sportos/`: Agent Plugins 1.0 manifest,
existing SportOS icon and the athlete-chat skill. Generate a bound private
archive with the verified App ID:

```sh
pnpm plugin:package -- --app-id asdk_app_<verified-id> --out /private/path/sportos.zip
```

The output path must be outside the repository and not already exist. The
packager creates and inspects exactly four files:

```text
sportos/plugin.json
sportos/.app.json
sportos/assets/icon.png
sportos/skills/athlete-chat/SKILL.md
```

The manifest references `./.app.json`, which reuses the registered App's OAuth
connection. It does not declare another raw MCP transport. This is a private
account/workspace package; public-directory submission or sharing is not requested.

Create the branded package once with Plugin Creator, or update the existing
SportOS package using its exact ID/current release. Preserve the icon, skill,
prompts and private audience. If updating a direct-transport package, remove
its obsolete `mcp.json` and generated `.mcp.json` declarations in the same update;
then verify inventory, App binding, release and retained assets. Do not create
replacement packages merely to refresh tools.

Open **SportOS**, connect its **SportOS MCP** dependency if needed, then use
**Try in chat** or select the connected plugin with `@`. An unrelated existing
project or custom GPT named Sportos is not the MCP connection. Verify the five
actual tools, then perform a bounded read. Installation or archive ingestion
alone is not proof that authentication or tool execution works.

For other MCP-aware hosts, the packager also retains direct-transport mode:

```sh
pnpm plugin:package -- --origin https://<render-api-host> --out /private/path/sportos-portable.zip
```

This emits `mcp.json` instead of `.app.json`, with `streamable-http`, OAuth,
`athlete:read` and public-client auth `none`. It does not register an App in
ChatGPT. The live verification identified that distinction; a raw MCP archive
alone was saved successfully but did not expose the connected tools in web chat.

The current [OpenAI authentication guidance](https://developers.openai.com/plugins/build/auth)
explains the stable callback, issuer identification, PKCE and resource binding;
[packaging guidance](https://developers.openai.com/plugins/build/plugins) covers
registering the connection before wiring its App into a skills package.

## Verification

Public checks (no credentials or training results):

```sh
curl -i https://<render-api-host>/.well-known/oauth-protected-resource/mcp
curl -i https://<render-api-host>/.well-known/oauth-authorization-server
curl -i -X POST https://<render-api-host>/mcp -H 'Content-Type: application/json' -d '{}'
```

Expect exact HTTPS issuer/resource metadata and a 401 with a `WWW-Authenticate`
resource-metadata challenge. No anonymous tool listing or data is returned.
Then install/approve in ChatGPT and ask a bounded question, such as training
volume for a chosen completed week. Verify the tool actually runs, references
SportOS evidence, and preserves units/coverage. Inspect the private response in
the host; do not paste personal evidence into GitHub or tracked files.

Verify that cancelling consent creates no token; repeated code exchanges fail;
expired/revoked credentials cannot read; MCP credentials cannot access normal API
routes; and owner A cannot read owner B's activity identifiers. Revoke access
from Services and confirm another read fails. The tool annotations alone are
not authorization: server checks and RLS enforce those boundaries.

Local focused commands:

```sh
pnpm --filter @sportos/api exec vitest run src/mcp src/auth/session.guard.test.ts src/auth/mobile-auth.test.ts src/auth/single-user-auth.test.ts
pnpm --filter @sportos/mcp exec vitest run src/server.test.ts
pnpm --filter @sportos/web exec vitest run src/app/features/mcp-connect/state/mcp-connect.store.test.ts src/app/app.routes.test.ts
pnpm --filter @sportos/api typecheck
pnpm --filter @sportos/web typecheck
pnpm --filter @sportos/web build
pnpm check:web-architecture
node --test scripts/package-chatgpt-plugin.test.mjs
SPORTOS_OWNER_TEST_DATABASE_URL=... pnpm --filter @sportos/db exec vitest run src/repositories/mcp-oauth.repository.integration.test.ts
```

Use only a disposable database for integration fixtures. Existing runtime roles
must remain non-owner. Fresh Flyway and a populated V144→V145 upgrade should
preserve existing account/session facts. Validation evidence and the exact
inspected-file list are in [implementation/issue-240.md](implementation/issue-240.md).

## Disable and rollback

Remove `SPORTOS_MCP_PUBLIC_ORIGIN` from Render and redeploy to disable the
connection immediately. Account-specific disconnect revokes its grants without
changing the deployment. Existing browser and mobile sessions remain independent.
Roll back application code only to a compatible release; V145 is append-only and
can remain in place. Never drop authentication tables or reset migration history
as part of rollback. Remove the private plugin through its normal management
flow if desired; do not publish it or broaden its audience.
