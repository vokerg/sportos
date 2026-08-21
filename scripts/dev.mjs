import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(repoRoot, '.env');
const apiOnly = process.argv.includes('--api-only');
const children = new Map();
let stopping = false;

if (existsSync(envPath)) loadEnvFile(envPath);
process.env.NODE_ENV ??= 'development';

const required = apiOnly
  ? ['DATABASE_URL']
  : ['DATABASE_URL', 'SPORTOS_WORKER_DATABASE_URL', 'SPORTOS_WORKER_DATA_DATABASE_URL'];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`Missing required .env values: ${missing.join(', ')}`);
  process.exit(1);
}

if (!process.env.SPORTOS_DEV_AUTH_TOKEN?.trim()) {
  console.warn('SPORTOS_DEV_AUTH_TOKEN is not set; local Sign in will require OIDC.');
}

const initialBuild = await runPnpm(['--filter', '@sportos/api', 'build']);
if (initialBuild !== 0) process.exit(initialBuild);

startPnpm('api:compile', [
  '--filter', '@sportos/api', 'exec', 'tsc', '-b', 'tsconfig.json', '--watch', '--pretty', 'false', '--preserveWatchOutput',
]);
startPnpm('api', ['--filter', '@sportos/api', 'exec', 'node', '--watch', 'dist/main.js']);

if (!apiOnly) {
  startPnpm('worker', ['--filter', '@sportos/worker', 'dev']);
  startPnpm('web', ['--filter', '@sportos/web', 'start']);
  console.log('\nSportOS dev is starting. Open http://localhost:4210\n');
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

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
  const child = spawnPnpm(args);
  children.set(label, child);
  child.once('exit', (code, signal) => {
    children.delete(label);
    if (stopping) return;
    console.error(`${label} stopped unexpectedly${signal ? ` (${signal})` : ` (exit ${code ?? 1})`}.`);
    shutdown(code ?? 1);
  });
  child.once('error', (error) => {
    console.error(`${label} failed to start:`, error);
    shutdown(1);
  });
}

function spawnPnpm(args) {
  return spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) terminate(child);
  children.clear();
  process.exit(exitCode);
}

function terminate(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}
