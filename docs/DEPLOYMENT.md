# Hosted deployment

Deployment work is tracked in issue #95. The reference is chess-trainer's Neon,
Render and Vercel setup. SportOS uses pnpm and opaque session cookies.

## Topology

- Vercel serves Angular and proxies `/api/:path*` to the Render API.
- One paid Render web service runs the API and worker as separate supervised
  processes. They share a persistent disk at `/var/data/sportos` for uploads.
- Existing primary and activity-detail Neon projects retain their separate
  runtime identities. Schema-owner credentials never enter Render or Vercel.

Render disks cannot be shared between services. Keeping the two processes on
one instance preserves the existing upload adapter without adding an object
store or changing provenance. The supervisor stops both processes if either
fails so Render restarts the complete service. This is a single-instance hobby
deployment; splitting services requires a shared object-storage adapter first.

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
`corepack pnpm install --frozen-lockfile && corepack pnpm build:backend` and start
with `node scripts/start-hosted.mjs`. Health check: `/health`. The supervisor
allows 20 seconds for graceful termination before killing a stuck child.

Mount a persistent disk at `/var/data/sportos` and set
`SPORTOS_UPLOAD_DIR=/var/data/sportos/uploads`. Only that disk survives deployments.
Disk-backed services have a brief outage during deploy and cannot scale out.

Set production environment variables through Render's secret settings:

- `NODE_ENV=production`, `SPORTOS_AUTH_MODE=single-user`, `SPORTOS_COOKIE_SECURE=true`;
- `SPORTOS_WEB_ORIGIN=https://<vercel-production-host>`;
- `SPORTOS_API_ORIGIN=https://<vercel-production-host>/api`;
- `SPORTOS_SINGLE_USER_USERNAME` and `SPORTOS_SINGLE_USER_PASSWORD_HASH`;
- primary `DATABASE_URL`, `SPORTOS_WORKER_DATABASE_URL`, `SPORTOS_WORKER_DATA_DATABASE_URL`;
- separate-project `SPORTOS_ACTIVITY_DETAIL_DATABASE_URL`;
- existing Strava client ID/secret and provider credential encryption key ring;
- `STRAVA_REDIRECT_URI=https://<vercel-production-host>/api/providers/strava/callback`;
- bounded worker settings from `.env.example`.

The supervisor passes API database/login secrets only to the API child, and
dispatcher/worker-data URLs only to the worker child. Both need Strava encryption
keys and upload storage. Neither child receives Flyway credentials or the legacy
CLI URL. Leave development authentication and optional external generation unset.

Keep the existing encryption key ring when using existing provider connections.
Set Strava's authorization callback domain to the Vercel production hostname.
Existing local provider connections retain their encrypted credentials.

## Vercel settings

Import the repository root as an **Other** project. `vercel.json` provides install,
hosted Angular build, output directory, no-store API headers and SPA routing.
There are no browser secrets or database URLs. Keep the Render hostname in the
external rewrite synchronized with the deployed service. Hosted builds replace
only the core API-base value; local builds retain localhost defaults.

Deploy the same reviewed commit to both hosts. Until the PR is merged, explicitly
select `issue-95-hosted-deployment` as the deployment source. Merging is a separate
maintainer action; switch production Git branches to `main` after that merge.

## Database, backup and rollback

No schema change is required for this deployment. Verify the existing primary
and activity-detail schema before startup. Future Flyway changes run once using
a separate operator/migration identity; never run owner migrations inside the
API/worker start command or supply owner credentials to hosted runtime services.

Preserve any pre-existing uploaded objects with their original opaque keys when
moving to the Render disk. Historical database provenance alone does not restore
the source files. Back up the Neon projects, upload disk and encryption key ring
together, with private access and retention appropriate to the source data.
Render disk snapshots are useful but do not replace a coordinated restore drill.
Do not delete files or recreate the disk when rolling back code.

Rollback uses the previous compatible commit on both platforms and preserves
the database, disk and key ring. Stop both supervised processes together before
restoring a coordinated backup. Database migrations are forward-only; a rollback
must remain compatible with persisted schema and queued jobs.

## Validation and status

Configuration is being prepared. Production resources and authenticated
end-to-end verification are not yet complete.
