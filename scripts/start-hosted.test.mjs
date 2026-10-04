import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { childEnvironments, runHosted } from './start-hosted.mjs';

const env = {
  NODE_ENV: 'production', SPORTOS_AUTH_MODE: 'single-user', SPORTOS_UPLOAD_DIR: '/var/data/sportos/uploads',
  DATABASE_URL: 'postgresql://sportos_app:example@primary/db',
  SPORTOS_ACTIVITY_DETAIL_DATABASE_URL: 'postgresql://sportos_app:example@detail/db',
  SPORTOS_WORKER_DATABASE_URL: 'postgresql://sportos_worker:example@primary/db',
  SPORTOS_WORKER_DATA_DATABASE_URL: 'postgresql://sportos_worker_data:example@primary/db',
  SPORTOS_SINGLE_USER_PASSWORD_HASH: 'example', SPORTOS_FLYWAY_PASSWORD: 'must-not-reach-runtime',
  SPORTOS_PROVIDER_CREDENTIAL_KEYS: 'shared-provider-key',
};
test('API and worker receive only their respective runtime credentials', () => {
  const { api, worker } = childEnvironments(env);
  assert.equal(api.DATABASE_URL, env.DATABASE_URL);
  assert.equal(api.SPORTOS_WORKER_DATABASE_URL, undefined);
  assert.equal(worker.DATABASE_URL, undefined);
  assert.equal(worker.SPORTOS_SINGLE_USER_PASSWORD_HASH, undefined);
  assert.equal(worker.SPORTOS_WORKER_DATA_DATABASE_URL, env.SPORTOS_WORKER_DATA_DATABASE_URL);
  assert.equal(api.SPORTOS_FLYWAY_PASSWORD, undefined);
  assert.equal(worker.SPORTOS_FLYWAY_PASSWORD, undefined);
});
test('hosted startup rejects development bypass, owner credentials and ephemeral relative storage', () => {
  for (const override of [{ SPORTOS_AUTH_MODE: 'dev-single-user' }, { SPORTOS_DEV_AUTH_TOKEN: 'test' },
    { DATABASE_URL: 'postgresql://owner:test@primary/db' }, { SPORTOS_UPLOAD_DIR: './data' }]) {
    assert.throws(() => childEnvironments({ ...env, ...override }));
  }
});
test('an unexpectedly stopped worker terminates the API and reports failure', async () => {
  const children = [];
  const result = runHosted(env, () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => { child.signalCode = signal; queueMicrotask(() => child.emit('exit', null, signal)); };
    children.push(child);
    return child;
  });
  children[0].exitCode = 1;
  children[0].emit('exit', 1);
  assert.equal(await result, 1);
  assert.equal(children[1].signalCode, 'SIGTERM');
});
