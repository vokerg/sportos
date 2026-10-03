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

## Status

Configuration is being prepared. Production resources and authenticated
end-to-end verification are not yet complete.
