import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const control = resolve('deploy/oracle/control.sh');
const sha = 'a'.repeat(40);
const images = ['web', 'api', 'worker'].map(service => `ghcr.io/vokerg/sportos-${service}@sha256:${'b'.repeat(64)}`);

async function host(t) {
  const root = await mkdtemp(join(tmpdir(), 'sportos-oracle-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'bin'));
  await mkdir(join(root, 'releases', sha), { recursive: true });
  await writeFile(join(root, 'releases', sha, 'compose.yml'), '# fixture');
  await writeFile(join(root, 'api.env'), '');
  await writeFile(join(root, 'worker.env'), '');
  await writeFile(join(root, 'deployment.env'), 'old deployment\n');
  await symlink(`releases/${sha}`, join(root, 'current'));
  // Host-command fixtures test orchestration on macOS too. Real flock/Compose
  // semantics require Ubuntu and live container validation; these are not faked claims.
  await writeFile(join(root, 'bin', 'flock'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(join(root, 'bin', 'mv'), `#!/usr/bin/env node
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
if(args[0] === '-Tf') fs.renameSync(args[1], args[2]);
else process.exit(spawnSync('/bin/mv',args).status);
`, { mode: 0o755 });
  await writeFile(join(root, 'bin', 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args)+'\\n');
if(process.env.FAIL_PULL && args[0] === 'pull') process.exit(1);
if(args.includes('ps')) console.log('test-container');
if(args[0] === 'inspect') console.log('healthy');
`, { mode: 0o755 });
  const run = (...args) => spawnSync('bash', [control, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SPORTOS_DEPLOY_ROOT: root, CALL_LOG: join(root, 'calls'), PATH: `${root}/bin:${process.env.PATH}` },
  });
  const calls = async () => (await readFile(join(root, 'calls'), 'utf8')).trim().split('\n').map(JSON.parse);
  return { root, run, calls };
}

test('deploy saves digest release, preserves previous state, and starts only API then web', async t => {
  const { root, run, calls } = await host(t);
  const result = run('deploy', sha, ...images);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(root, 'previous.env'), 'utf8'), 'old deployment\n');
  const manifest = await readFile(join(root, 'deployment.env'), 'utf8');
  for (const image of images) assert.ok(manifest.includes(image));
  const commands = await calls();
  assert.equal(commands.filter(args => args[0] === 'pull').length, 3);
  const starts = commands.filter(args => args.includes('up'));
  assert.deepEqual(starts.map(args => args.at(-1)), ['api', 'web']);
  assert.ok(starts.every(args => args.includes('--no-deps') && args.includes('--wait')));
  assert.ok(starts.every(args => args.includes(join(root, 'releases', sha, 'compose.yml'))));
});

test('start/restart use saved containers without pulling or starting worker', async t => {
  const { run, calls } = await host(t);
  for (const operation of ['start', 'restart']) {
    const result = run(operation, 'all');
    assert.equal(result.status, 0, result.stderr);
  }
  const commands = await calls();
  assert.ok(commands.every(args => !args.includes('pull') && !args.includes('worker')));
  assert.ok(commands.some(args => args.slice(-3).join(' ') === 'start api web'));
  assert.ok(commands.some(args => args.slice(-3).join(' ') === 'restart api web'));
});

test('stop all includes worker and never removes containers', async t => {
  const { run, calls } = await host(t);
  assert.equal(run('stop', 'all').status, 0);
  const commands = await calls();
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].slice(-4), ['stop', 'web', 'api', 'worker']);
});

test('worker and invalid operations fail before any container command', async t => {
  const { root, run } = await host(t);
  for (const args of [['start', 'worker'], ['restart', 'worker'], ['start', 'arbitrary'], ['destroy', 'all']]) {
    assert.notEqual(run(...args).status, 0);
  }
  await assert.rejects(readFile(join(root, 'calls')), { code: 'ENOENT' });
});

test('untrusted image references and malformed SHA cannot alter saved deployment', async t => {
  const { root, run } = await host(t);
  assert.notEqual(run('deploy', '../../escape', ...images).status, 0);
  assert.notEqual(run('deploy', sha, 'ghcr.io/other/web:latest', ...images.slice(1)).status, 0);
  assert.equal(await readFile(join(root, 'deployment.env'), 'utf8'), 'old deployment\n');
  await assert.rejects(readFile(join(root, 'calls')), { code: 'ENOENT' });
});

test('pull failure preserves selected release metadata', async t => {
  const { root } = await host(t);
  const result = spawnSync('bash', [control, 'deploy', sha, ...images], {
    encoding: 'utf8', env: { ...process.env, FAIL_PULL: '1', SPORTOS_DEPLOY_ROOT: root,
      CALL_LOG: join(root, 'calls'), PATH: `${root}/bin:${process.env.PATH}` },
  });
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(join(root, 'deployment.env'), 'utf8'), 'old deployment\n');
});

test('SSH transport preserves remote script exactly and sends private bundle over stdin', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sportos-ssh-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'bin'));
  await writeFile(join(root, 'bin', 'ssh'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.ARG_CAPTURE, JSON.stringify(process.argv.slice(2)));
process.stdin.pipe(fs.createWriteStream(process.env.TAR_CAPTURE));
`, { mode: 0o755 });
  const result = spawnSync('bash', ['deploy/oracle/ssh-operation.sh', 'deploy'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`,
      ORACLE_HOST: 'oracle.example.com', ORACLE_USER: 'sportos-deploy',
      ORACLE_SSH_KEY: 'synthetic-private-key', ORACLE_SSH_HOST_KEY: 'synthetic-host-key',
      RELEASE_SHA: sha, WEB_IMAGE: images[0], API_IMAGE: images[1], WORKER_IMAGE: images[2],
      GHCR_TOKEN: 'synthetic-token', GHCR_USER: 'synthetic-user',
      ARG_CAPTURE: join(root, 'args.json'), TAR_CAPTURE: join(root, 'bundle.tar') },
  });
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(await readFile(join(root, 'args.json'), 'utf8'));
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  assert.ok(args.includes('BatchMode=yes'));
  const encoded = args.at(-1).match(/printf %s ([A-Za-z0-9+/=]+) \| base64 -d/)[1];
  assert.equal(Buffer.from(encoded, 'base64').toString(), (await readFile('deploy/oracle/remote.sh', 'utf8')).trimEnd() + '\n');
  // The actual remote shell must parse the command, including its nested quotes.
  assert.equal(spawnSync('bash', ['-n', '-c', args.at(-1)]).status, 0);
  const manifest = spawnSync('tar', ['-xOf', join(root, 'bundle.tar'), './manifest'], { encoding: 'utf8' });
  assert.equal(manifest.status, 0, manifest.stderr);
  assert.deepEqual(manifest.stdout.trim().split('\n'), [sha, ...images]);
  assert.ok(!args.join(' ').includes('synthetic-token'));
});
