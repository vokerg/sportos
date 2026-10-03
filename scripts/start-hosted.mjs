import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const commonKeys = ['PATH', 'HOME', 'LANG', 'TZ', 'NODE_ENV', 'SPORTOS_UPLOAD_DIR',
  'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_AUTH_BASE_URL', 'STRAVA_API_BASE_URL',
  'SPORTOS_PROVIDER_CREDENTIAL_KEYS', 'SPORTOS_PROVIDER_ACTIVE_KEY_ID'];
const apiKeys = ['PORT', 'API_PORT', 'DATABASE_URL', 'SPORTOS_ACTIVITY_DETAIL_DATABASE_URL',
  'SPORTOS_AUTH_MODE', 'SPORTOS_WEB_ORIGIN', 'SPORTOS_API_ORIGIN', 'SPORTOS_COOKIE_SECURE',
  'SPORTOS_SINGLE_USER_USERNAME', 'SPORTOS_SINGLE_USER_PASSWORD_HASH',
  'SPORTOS_SESSION_IDLE_SECONDS', 'SPORTOS_SESSION_ABSOLUTE_SECONDS',
  'SPORTOS_OIDC_ISSUER', 'SPORTOS_OIDC_CLIENT_ID', 'SPORTOS_OIDC_CLIENT_SECRET',
  'SPORTOS_LEGACY_OIDC_ISSUER', 'SPORTOS_LEGACY_OIDC_SUBJECT', 'STRAVA_REDIRECT_URI',
  'SPORTOS_AI_JSON_ENDPOINT', 'SPORTOS_AI_MODEL', 'SPORTOS_AI_API_KEY', 'SPORTOS_AI_TIMEOUT_MS'];
const workerKeys = ['SPORTOS_WORKER_DATABASE_URL', 'SPORTOS_WORKER_DATA_DATABASE_URL',
  'IMPORT_WORKER_CONCURRENCY', 'IMPORT_JOB_LEASE_SECONDS', 'IMPORT_JOB_POLL_MS'];

export function childEnvironments(env) {
  if (env.NODE_ENV !== 'production') throw new Error('Hosted startup requires NODE_ENV=production.');
  if (env.SPORTOS_AUTH_MODE === 'dev-single-user' || env.SPORTOS_DEV_AUTH_TOKEN) {
    throw new Error('Development authentication is forbidden in hosted operation.');
  }
  if (!env.SPORTOS_UPLOAD_DIR?.startsWith('/')) throw new Error('An absolute persistent upload directory is required.');
  for (const [key, role] of [
    ['DATABASE_URL', 'sportos_app'],
    ['SPORTOS_ACTIVITY_DETAIL_DATABASE_URL', 'sportos_app'],
    ['SPORTOS_WORKER_DATABASE_URL', 'sportos_worker'],
    ['SPORTOS_WORKER_DATA_DATABASE_URL', 'sportos_worker_data'],
  ]) {
    let url;
    try { url = new URL(env[key]); } catch { throw new Error(`${key} is required.`); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.username) !== role) {
      throw new Error(`${key} must use the dedicated ${role} runtime role.`);
    }
  }
  const select = (keys) => Object.fromEntries([...commonKeys, ...keys]
    .filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
  return { api: select(apiKeys), worker: select(workerKeys) };
}

export async function runHosted(env = process.env, spawnProcess = spawn) {
  const environments = childEnvironments(env);
  const children = [];
  let stopping = false;
  let failed = false;
  let timer;
  const stop = (failure = false) => {
    failed ||= failure;
    if (stopping) return;
    stopping = true;
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    timer = setTimeout(() => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 20_000);
    timer.unref();
  };
  const signal = () => stop();
  process.once('SIGTERM', signal);
  process.once('SIGINT', signal);
  try {
    const completions = [];
    for (const [name, path] of [['worker', 'apps/worker/dist/import-worker.js'], ['api', 'apps/api/dist/main.js']]) {
      const child = spawnProcess(process.execPath, [path], { cwd: root, env: environments[name], stdio: 'inherit' });
      children.push(child);
      completions.push(new Promise((done) => {
        child.once('error', () => { console.error(`SportOS ${name} could not start.`); stop(true); done(); });
        child.once('exit', () => {
          if (!stopping) { console.error(`SportOS ${name} stopped unexpectedly.`); stop(true); }
          done();
        });
      }));
    }
    await Promise.all(completions);
    return failed ? 1 : 0;
  } finally {
    if (timer) clearTimeout(timer);
    process.removeListener('SIGTERM', signal);
    process.removeListener('SIGINT', signal);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHosted().then((code) => { process.exitCode = code; }).catch(() => {
    console.error('Hosted startup failed. Check required server configuration.');
    process.exitCode = 1;
  });
}
