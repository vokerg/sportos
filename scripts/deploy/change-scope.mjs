/**
 * Production deploy change scopes.
 *
 * Deliberately conservative: unknown paths affect both services rather than
 * allowing a new build input to silently leave a deployed service stale.
 * Keep the Render ignored-path configuration in docs/DEPLOYMENT.md aligned.
 */
const sharedBuildFiles = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.node-version',
]);
const nonRuntimeFiles = new Set([
  '.dockerignore',
  '.editorconfig',
  '.env.example',
  '.gitattributes',
  '.gitignore',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'Dockerfile',
  'README.md',
]);

export function affectedServices(paths) {
  const affected = { frontend: false, backend: false };
  for (const filename of paths) {
    // GitHub / git paths always use slash; suspicious inputs fail open.
    const path = String(filename).replace(/^\.\//, '');
    if (!path || path.startsWith('/') || path.includes('\\') || path.includes('..')) {
      affected.frontend = affected.backend = true;
    } else if (path === 'vercel.json' || path.startsWith('apps/web/')) {
      affected.frontend = true;
    } else if (path.startsWith('packages/')) {
      // Angular imports shared source directly (for example home-summary.ts).
      // Keep all packages conservative as consumers evolve across runtimes.
      affected.frontend = affected.backend = true;
    } else if (
      path.startsWith('apps/api/') ||
      path.startsWith('apps/worker/') ||
      path.startsWith('apps/mcp/') ||
      path.startsWith('flyway/') ||
      path.startsWith('tools/garmin/') ||
      path.startsWith('deploy/gcp/')
    ) {
      affected.backend = true;
    } else if (
      sharedBuildFiles.has(path) ||
      /^tsconfig[^/]*\.json$/.test(path) ||
      path.startsWith('scripts/deploy/')
    ) {
      affected.frontend = affected.backend = true;
    } else if (
      nonRuntimeFiles.has(path) ||
      path.startsWith('apps/mobile/') ||
      path.startsWith('docs/') ||
      path.startsWith('.github/') ||
      path.startsWith('deploy/docker/') ||
      path.startsWith('deploy/oracle/')
    ) {
      // No active hosted runtime is affected.
    } else {
      // This includes new workspaces, root build inputs and unclassified scripts.
      affected.frontend = affected.backend = true;
    }
  }
  return affected;
}
