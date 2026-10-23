import { existsSync, watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { supervise } from './dev-supervisor.mjs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(repoRoot, '.env');
const apiOnly = process.argv.includes('--api-only');
const workerOnly = process.argv.includes('--worker-only');
const children = new Map();
const watchers = [];
let reloadTimer;
let stopping = false;

if (existsSync(envPath)) loadEnvFile(envPath);
if (process.env.SPORTOS_UPLOAD_DIR && !isAbsolute(process.env.SPORTOS_UPLOAD_DIR)) {
  process.env.SPORTOS_UPLOAD_DIR = resolve(repoRoot, process.env.SPORTOS_UPLOAD_DIR);
}
process.env.NODE_ENV ??= 'development';

const required = [
  ...(!workerOnly ? ['DATABASE_URL'] : []),
  ...(!apiOnly ? ['SPORTOS_WORKER_DATABASE_URL', 'SPORTOS_WORKER_DATA_DATABASE_URL'] : []),
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`Missing required .env values: ${missing.join(', ')}`);
  process.exit(1);
}

if (!workerOnly && process.env.SPORTOS_AUTH_MODE !== 'dev-single-user' && !process.env.SPORTOS_DEV_AUTH_TOKEN?.trim()) {
  console.warn('SPORTOS_DEV_AUTH_TOKEN is not set; local Sign in will require OIDC.');
}

// Project-reference declarations are generated artifacts and can outlive a
// squash merge in a shared checkout. Force the initial graph build so the API
// never starts against stale package declarations (the watch build can remain
// incremental after this refresh).
const projects = [
  ...(!workerOnly ? ['apps/api'] : []),
  ...(!apiOnly ? ['apps/worker'] : []),
];
const initialBuild = await runPnpm(['exec', 'tsc', '-b', ...projects, '--force', '--pretty', 'false']);
if (initialBuild !== 0) process.exit(initialBuild);

startPnpm('backend:compile', ['exec', 'tsc', '-b', ...projects, '--watch', '--pretty', 'false', '--preserveWatchOutput']);
if (!workerOnly) startRuntime('api', 'apps/api/dist/main.js');
if (!apiOnly) startRuntime('worker', 'apps/worker/dist/import-worker.js');
if (!apiOnly && !workerOnly) {
  startPnpm('web', ['--filter', '@sportos/web', 'start']);
  console.log('\nSportOS dev is starting. Open http://localhost:4210\n');
}

// Watch compiled output rather than running a watcher that stays alive after its
// runtime crashes. The initial project build ensures these directories exist.
for (const dir of [...projects, 'packages/db', 'packages/domain', 'packages/shared', 'packages/importers', 'packages/analytics']) {
  const output = resolve(repoRoot, dir, 'dist');
  if (!existsSync(output)) continue;
  watchers.push(watch(output, { recursive: true }, (_event, filename) => {
    if (filename && !filename.endsWith('.js')) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      children.get('api')?.restart();
      children.get('worker')?.restart();
    }, 300);
  }));
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

function startRuntime(label, entry) {
  children.set(label, supervise(process.execPath, [resolve(repoRoot, entry)], {
    cwd: repoRoot, env: process.env, label,
  }));
}

function runPnpm(args) {
  return new Promise((resolveCode) => {
    const child = spawnPnpm(args);
    child.once('exit', (code) => resolveCode(code ?? 1));
    child.once('error', (error) => {
      console.error(error);
      resolveCode(1);
    });
  });
}

function startPnpm(label, args) {
  children.set(label, supervise(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: repoRoot, env: process.env, label,
  }));
}

function spawnPnpm(args) {
  return spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(reloadTimer);
  for (const watcher of watchers) watcher.close();
  await Promise.all([...children.values()].map((child) => child.stop()));
  children.clear();
}
