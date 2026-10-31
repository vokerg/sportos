import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = resolve('deploy/gcp/ssh-operation.sh');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sportos-transport-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = join(dir, 'calls');
  await writeFile(join(dir, 'gcloud'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALL_LOG: log,
    GCP_PROJECT_ID: 'example-project', GCP_VM_NAME: 'example-vm', GCP_VM_ZONE: 'us-central1-c',
    GCP_SSH_KNOWN_HOSTS: 'compute.123 ssh-ed25519 EXAMPLE' };
  return { env, log, dir };
}
for (const op of ['start', 'stop', 'restart', 'status']) {
  test(`${op} uses IAP, host pinning and only the fixed service helper`, async t => {
    const { env, log } = await fixture(t);
    const result = spawnSync('bash', [script, op], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const call = await readFile(log, 'utf8');
    assert.match(call, /--tunnel-through-iap/);
    assert.match(call, /--strict-host-key-checking=yes/);
    assert.match(call, /UserKnownHostsFile=/);
    assert.match(call, new RegExp(`sportos-worker-control ${op}`));
    assert.doesNotMatch(call, /compute scp|worker-deploy|setMetadata|set-metadata/);
  });
}
test('shell metacharacters and unknown operations never reach gcloud', async t => {
  const { env, log } = await fixture(t);
  for (const op of ['rollback', 'deploy;id', 'poweroff']) {
    assert.equal(spawnSync('bash', [script, op], { env }).status, 2);
  }
  env.GCP_VM_NAME = 'bad;id';
  assert.equal(spawnSync('bash', [script, 'status'], { env }).status, 2);
  assert.equal(await readFile(log, 'utf8').catch(() => ''), '');
});
