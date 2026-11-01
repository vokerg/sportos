# Hosted deployment

Deployment work is tracked in issue #95. The reference is chess-trainer's Neon,
Render and Vercel setup. SportOS uses pnpm and opaque session cookies.

Parallel Oracle preparation is documented in [ORACLE_DEPLOYMENT.md](ORACLE_DEPLOYMENT.md)
(#147). It does not enable the deferred shared-storage/worker phase.

Native deployment and operations for the existing GCP worker VM are documented in
[gcp-worker-deployment.md](gcp-worker-deployment.md). It does not change the
API/web topology or automatically solve shared source storage.

## Topology

- Vercel serves Angular and proxies `/api/:path*` to the Render API.
- One free Render web service runs the API only. A separate GCP systemd worker
  is deployed for provider synchronization and rule recomputation with
  `SPORTOS_IMPORT_WORKER_ENABLED=false`; uploaded CSV/XLSX jobs remain unclaimed
  by that worker until shared storage is available. See [GCP worker setup](gcp-worker-deployment.md).
- Existing primary and activity-detail Neon projects retain their separate
  runtime identities. Schema-owner credentials never enter Render or Vercel.

Render's free web service has no persistent disk and may sleep after inactivity.
`SPORTOS_UPLOAD_DIR` therefore points at ephemeral `/tmp` storage. Do not rely on
uploaded files surviving a restart, and avoid starting upload/import workflows
until the worker and shared object storage are deployed. Existing canonical data
and read-only application workflows remain backed by Neon.

The Vercel proxy keeps the session and readable CSRF cookie on the frontend
origin. OIDC and Strava callbacks must use the Vercel `/api` URL, not the direct
Render hostname. Personalized API responses must never be cached.

## Investigation

Before implementation, inspected:

- `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`,
  `docs/AUTHENTICATION.md`, `docs/AI_ANALYSIS.md`, `docs/FRONTEND_ARCHITECTURE.md`;
- ADRs 0002, 0003, 0005, 0006 and 0007;
- root/API/worker/web `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`;
- `apps/api/src/main.ts`, `app.module.ts`, `db.provider.ts`,
  `health/health.controller.ts`, `auth/auth.service.ts`, `auth/auth.controller.ts`,
  `auth/auth.models.ts`, `storage/upload-storage.ts`, `storage/local-upload-storage.ts`;
- `packages/importers/src/upload-storage.ts`, `packages/db/src/schema.ts`,
  `flyway/sql/V103__add_uploaded_files.sql`, `apps/worker/src/import-worker.ts`;
- `apps/web/angular.json`, `src/app/app.config.ts`, `src/app/web-auth.service.ts`,
  `src/app/core/config/api-base.ts`, `src/app/core/http/auth-http.interceptor.ts`,
  `src/app/core/http/auth-http.interceptor.test.ts`, `src/app/core/http/sportos-api-origin.ts`;
- local environment variable presence only (no secret values recorded);
- chess-trainer's `vercel.json`, `Dockerfile`, `docs/deployment.md` and deployed
  Render settings; SportOS queue #3, open issues and PR #94's changed-file list.

Documentation mismatches: the roadmap schema baseline still says V119 while
README and authentication deployment instructions describe V123; analysis
validation text still references V122. Queue #3 also leaves #78 unchecked despite
the documented completed implementation. This deployment does not infer schema
state from those summaries or change unrelated queue items.

## Render settings

Repository root, Node 22, Frankfurt region. Build with
`corepack pnpm install --prod=false --frozen-lockfile && corepack pnpm build:api:hosted` and
start with `node apps/api/dist/main.js`. Health check: `/health`. Select the free
0.1 CPU/512 MB plan, attach no disk, and set
`SPORTOS_UPLOAD_DIR=/tmp/sportos/uploads`. Expect a cold start after inactivity.

Set production environment variables through Render's secret settings:

- `NODE_ENV=production`, `SPORTOS_AUTH_MODE=single-user`, `SPORTOS_COOKIE_SECURE=true`;
- `SPORTOS_WEB_ORIGIN=https://<vercel-production-host>`;
- `SPORTOS_API_ORIGIN=https://<vercel-production-host>/api`;
- `SPORTOS_SINGLE_USER_USERNAME` and `SPORTOS_SINGLE_USER_PASSWORD_HASH`;
- primary `DATABASE_URL`;
- separate-project `SPORTOS_ACTIVITY_DETAIL_DATABASE_URL`;
- existing Strava client ID/secret and provider credential encryption key ring;
- `STRAVA_REDIRECT_URI=https://<vercel-production-host>/api/providers/strava/callback`;
- no dispatcher, worker-data or worker tuning settings.

The API receives only its non-owner database/login secrets, the activity-detail
runtime URL, Strava configuration and the provider encryption key ring. It does
not receive dispatcher, worker-data, Flyway, schema-owner or legacy CLI URLs.
Leave development authentication unset. To enable the web Chat, set
`SPORTOS_AI_CHAT_ENDPOINT`, `SPORTOS_AI_MODEL`, `SPORTOS_AI_API_KEY` and
`SPORTOS_AI_TIMEOUT_MS` on the Render API service only; see [CHAT.md](CHAT.md).
Keep `SPORTOS_AI_JSON_ENDPOINT` unset unless using the separate legacy JSON
gateway. These secrets never belong in Vercel frontend variables.

Keep the existing encryption key ring when using existing provider connections.
Set Strava's authorization callback domain to the Vercel production hostname.
Existing local provider connections retain their encrypted credentials.

### Render build filtering (one-time dashboard action)

In the **Render API service** → **Settings** → **Build & Deploy** → **Build Filters**,
configure the following **Ignored Paths** (not Included Paths):

```text
apps/web/**
apps/mobile/**
docs/**
.github/**
deploy/docker/**
deploy/oracle/**
vercel.json
README.md
AGENTS.md
CONTRIBUTING.md
Dockerfile
.dockerignore
.env.example
.gitignore
.gitattributes
.editorconfig
```

Keep Root Directory at the **repository root**, auto-deploy enabled, and the
service branch at `main`. With only ignored paths, any backend change
(`apps/api/**`, `apps/worker/**`, `apps/mcp/**`, `packages/**`,
`tools/garmin/**`, `flyway/**`, `deploy/gcp/**`, shared lockfiles,
or an unclassified new build input) triggers **Render API redeployment**.
This is intentionally fail-open for new backend dependencies. A change under
`apps/web/**` alone does not redeploy the API. Do not add a blanket
`packages/**` exclusion.

These settings are **not** committed to this repository: configure/verify them
in the Render dashboard before relying on selective deployments. Render build
filters affect automatic Git deployments, not manual deploys or service-setting
changes. Updating filters may itself cause a deployment.

## Vercel settings

Import the repository root as an **Other** project. `vercel.json` provides install,
hosted Angular build, output directory, no-store API headers and SPA routing.
There are no browser secrets or database URLs. Keep the Render hostname in the
external rewrite synchronized with the deployed service. Hosted builds replace
only the core API-base value; local builds retain localhost defaults.

The created production domain is `https://sportos-delta.vercel.app`; use that
exact origin for API CORS, browser redirects, and the Strava callback URL.
The Render API hostname is `https://sportos-api-5qdc.onrender.com`; Vercel's
`/api` rewrite targets that exact service.

### Vercel build filtering (one-time dashboard action)

In the **Vercel frontend project** → **Settings** → **Build and Deployment**
→ **Ignored Build Step**, choose a custom Node script and set:

```sh
node scripts/deploy/vercel-ignore-build.mjs
```

Keep the project Root Directory at the **repository root** and Production
Branch at `main`; `vercel.json` already disables non-main Git deployments.
Vercel must expose the system environment variable
`VERCEL_GIT_PREVIOUS_SHA` to the ignored-build script (enable automatic
system variables if necessary). The script compares the current commit against
the **last successful** frontend deployment, not just `HEAD^`, so consecutive
backend-only merges cannot hide a later frontend change. Missing history
(Vercel shallow clone), initial deployments and unknown paths **build** instead
of skipping. Vercel's exit convention is 0 = skip and 1 = build.
A skipped build shows as canceled and may still count toward Vercel deployment
limits. The platform's automatic monorepo skip feature may be a future
alternative; do not enable two competing skip strategies without validation.

### Production deployment scopes

```text
apps/web/**, vercel.json             -> Vercel frontend
apps/api/**, apps/worker/**,         -> Render API + GCP worker
apps/mcp/**,
tools/garmin/**, flyway/**,
deploy/gcp/**
packages/**, root build/dependency  -> both frontend and backend
configuration
docs, mobile, inactive Oracle files -> neither
unknown/unclassified paths         -> both (conservative)
```

The source-of-truth classifier for Vercel and the GCP workflow is
`scripts/deploy/change-scope.mjs`, checked by
`scripts/deploy/change-scope.test.mjs`. Keep the manually configured Render
ignore list above aligned with it. Merged backend PRs trigger GCP packaging
only after the existing CI passes; the worker deploy is still gated by
`GCP_WORKER_DEPLOY_ENABLED`. Vercel/Render deploy independently from `main`
and are **not atomically coupled** to GCP. Validate cross-version API/worker,
queued-job and schema compatibility before making breaking changes.

A later frontend-only merge does not invalidate a pending GCP worker release.
A later backend merge does: its own deployment must supersede the older
worker release. Direct pushes to `main` are not an automatic GCP worker
deploy trigger; protect `main` against direct pushes and use merged PRs.
Do not run Flyway from these deployment workflows.

### Deployment smoke checks

Once both dashboards are configured, merge separately: a frontend-only PR
(Vercel yes, Render/GCP no), an API-only PR (Render/GCP yes, Vercel no),
and a shared package PR (Vercel/Render/GCP yes). Angular currently imports
shared source directly, so package changes conservatively rebuild both sides.
A docs-only PR should
trigger none of the three hosted deployments. The full repository CI remains
required for every PR regardless of deployment scope.

## Database, backup and rollback

No schema change is required for this deployment. Verify the existing primary
and activity-detail schema before startup. Future Flyway changes run once using
a separate operator/migration identity; never run owner migrations inside the
API/worker start command or supply owner credentials to hosted runtime services.

Historical database provenance alone does not restore source files. The free
API-only deployment does not migrate local uploaded objects, and its temporary
upload directory is not a backup. Back up the Neon projects, local source files
and encryption key ring together, with private access and retention appropriate
to the source data.

Rollback uses the previous compatible commit on both platforms and preserves
the database and key ring. Database migrations are forward-only; a rollback must
remain compatible with persisted schema and queued jobs.

## Validation and status

The Vercel frontend and free Render API are live. Authenticated browser
verification covered the Vercel-to-Render health proxy, password sign-in,
session-backed Overview, canonical Activities, provider status and an activity
detail including the separate activity-detail database. The GCP worker is now
active for provider synchronization and rule processing as documented in
[gcp-worker-deployment.md](gcp-worker-deployment.md); uploaded CSV/XLSX
polling remains disabled pending durable shared upload storage.
Deployment filtering requires the one-time Render/Vercel dashboard steps above;
this repository change alone does not activate those hosted build filters.
