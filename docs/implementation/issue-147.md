# Issue #147: Oracle deployment preparation

Maintainer explicitly authorized repository-side work on 2026-10-15 while
waiting for Oracle A1 capacity. #95 remains deferred; no storage implementation,
production-setting change, migration or resource provisioning is included.

Inspected before implementation:

- AGENTS.md, README.md, docs/ARCHITECTURE.md, docs/ROADMAP.md,
  docs/AUTHENTICATION.md, docs/AI_ANALYSIS.md, docs/DEPLOYMENT.md,
  docs/FRONTEND_ARCHITECTURE.md and ADRs 0002/0003/0005/0006/0007;
- root and apps/{api,worker,web}/package.json, packages/*/package.json,
  pnpm-workspace.yaml, tsconfig.base.json, .env.example, .gitignore,
  .github/workflows/ci.yml, apps/web/angular.json;
- apps/api/src/{main,hosted-config,app.module}.ts,
  apps/api/src/health/health.controller.ts,
  packages/importers/src/upload-storage.ts,
  apps/worker/src/{import-worker,import-job-runner,provider-sync-runner,rule-change-runner}.ts;
- apps/web/src/app/core/config/api-base{,.value,.value.hosted}.ts;
- issue #147/#95 bodies and comments, all open issue titles/labels, open PRs,
  recent merged PRs and origin/main (acf2eb6);
- chess reference Dockerfile, deploy/docker/compose.yml and
  docs/docker-manual-deployment.md; official Oracle Always Free and Docker Ubuntu
  installation documentation.

Mismatch: issue #147 asks for a full runnable worker, but the current local-only
storage contract cannot support Render uploads. Deferring #95 forbids treating
an Oracle bind mount as the solution. Compose and lifecycle controls fail closed
for worker start/restart. Three images can still build/publish before a host exists.

Validation performed:

- `pnpm build:backend` and `pnpm build:web:hosted` passed.
- `actionlint .github/workflows/oracle-*.yml` passed.
- `shellcheck deploy/oracle/*.sh` and Bash syntax checks passed.
- `node --test deploy/oracle/control.test.mjs`: six orchestration tests passed,
  using host-command fixtures (not a real container/lock test).
- `pnpm --filter @sportos/api deploy --prod <temporary-directory>` passed;
  isolated deployed workspace imports resolved successfully.

Local Docker daemon is unavailable; opening Docker Desktop failed and its CLI
status reports it unhealthy. Actual image builds/ARM64 container execution have
not been verified. The manual publish workflow runs on native ARM64 and includes
runtime import and web/proxy smoke checks without production credentials.
Oracle capacity/account, VM, host bootstrap, secrets, GHCR publishing, production
schema compatibility, browser auth/OAuth, shared storage and worker job execution
remain unverified. No live infrastructure or production settings were changed.
