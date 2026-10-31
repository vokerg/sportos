import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readlink, symlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const script = resolve('deploy/gcp/deploy.sh');
const linux = { skip: process.platform !== 'linux' ? 'Uses Linux flock/GNU coreutils; exercised by the CI packaging job' : false };
const sha = 'a'.repeat(40), old = `${'b'.repeat(40)}-1-1`, release = `${sha}-2-1`;
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sportos-deploy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const sub of ['releases', 'incoming', 'bin', 'package/runtime', 'package/apps/worker/dist', 'package/tools/garmin', 'package/wheels']) await mkdir(join(dir, sub), { recursive: true });
  await writeFile(join(dir, 'ready'), 'operator-approved fixture');
  await writeFile(join(dir, 'package/REVISION'), sha);
  await writeFile(join(dir, 'package/apps/worker/dist/import-worker.js'), '');
  await writeFile(join(dir, 'package/runtime/node'), '#!/bin/sh\nif [ "$1" = -p ]; then echo 22; fi\n', { mode: 0o755 });
  await writeFile(join(dir, 'package/tools/garmin/requirements.txt'), '');
  await writeFile(join(dir, 'bin/python3'), `#!/bin/bash
if [[ $1 == -c ]]; then exit 0; fi
if [[ $1 == -m && $2 == venv ]]; then
  mkdir -p "$3/bin"
  printf '#!/bin/sh\\nexit 0\\n' > "$3/bin/pip"
  cp "$3/bin/pip" "$3/bin/python"
  chmod +x "$3/bin/pip" "$3/bin/python"
  exit 0
fi
exec "$REAL_PYTHON" "$@"
`, { mode: 0o755 });
  await writeFile(join(dir, 'bin/sudo'), `#!/bin/bash
printf '%s\\n' "$*" >> "$CONTROL_LOG"
if [[ $FAIL_RESTART == true && \${*: -1} == restart && ! -f $FAILED_ONCE ]]; then
  touch "$FAILED_ONCE"; exit 1
fi
`, { mode: 0o755 });
  const realPython = spawnSync('which', ['python3'], { encoding: 'utf8' }).stdout.trim();
  const archive = join(dir, 'incoming', `${release}.tar.gz`);
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', join(dir, 'package'), '.']).status, 0);
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  const env = { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, SPORTOS_DEPLOY_ROOT: dir,
    SPORTOS_READY_FILE: join(dir, 'ready'), REAL_PYTHON: realPython, CONTROL_LOG: join(dir, 'calls'),
    FAIL_RESTART: 'false', FAILED_ONCE: join(dir, 'failed-once') };
  return { dir, env, digest, archive, run: (op = 'deploy', id = release, hash = digest) => spawnSync('bash', [script, op, id, hash], { env, encoding: 'utf8' }) };
}
async function previous(dir) {
  await mkdir(join(dir, 'releases', old, 'venv/bin'), { recursive: true });
  await writeFile(join(dir, 'releases', old, 'REVISION'), 'b'.repeat(40));
  await writeFile(join(dir, 'releases', old, 'venv/bin/python'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await symlink(join(dir, 'releases', old), join(dir, 'current'));
}
test('deployment activates a complete release, preserves external configuration and removes upload', linux, async t => {
  const f = await fixture(t); await previous(f.dir);
  await writeFile(join(f.dir, 'private-config'), 'untouched');
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(await readlink(join(f.dir, 'current')), join(f.dir, 'releases', release));
  assert.equal(await readlink(join(f.dir, 'previous')), join(f.dir, 'releases', old));
  assert.equal(await readFile(join(f.dir, 'private-config'), 'utf8'), 'untouched');
  assert.deepEqual(await readdir(join(f.dir, 'incoming')), []);
});
test('failed restart restores and restarts previous release, returning failure', linux, async t => {
  const f = await fixture(t); await previous(f.dir); f.env.FAIL_RESTART = 'true';
  const r = f.run(); assert.equal(r.status, 1, r.stderr);
  assert.equal(await readlink(join(f.dir, 'current')), join(f.dir, 'releases', old));
  assert.equal((await readFile(join(f.dir, 'calls'), 'utf8')).match(/ restart/g)?.length, 2);
});
test('first deployment failure stops the service and removes current link', linux, async t => {
  const f = await fixture(t); f.env.FAIL_RESTART = 'true';
  const r = f.run(); assert.equal(r.status, 1, r.stderr);
  assert.equal(await readlink(join(f.dir, 'current')).catch(() => null), null);
  assert.match(await readFile(join(f.dir, 'calls'), 'utf8'), / stop/);
});
test('bad checksum leaves current untouched without restarting', linux, async t => {
  const f = await fixture(t); await previous(f.dir);
  assert.notEqual(f.run('deploy', release, '0'.repeat(64)).status, 0);
  assert.equal(await readlink(join(f.dir, 'current')), join(f.dir, 'releases', old));
  assert.equal(await readFile(join(f.dir, 'calls'), 'utf8').catch(() => ''), '');
});
test('archive traversal is rejected before activation', linux, async t => {
  const f = await fixture(t);
  assert.equal(spawnSync(f.env.REAL_PYTHON, ['-c', `import tarfile,io,sys
with tarfile.open(sys.argv[1], 'w:gz') as t:
 m=tarfile.TarInfo('../escape'); m.size=1; t.addfile(m,io.BytesIO(b'x'))`, f.archive]).status, 0);
  const digest = createHash('sha256').update(await readFile(f.archive)).digest('hex');
  const r = f.run('deploy', release, digest);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /Invalid archive path/);
});
test('rollback switches an existing complete release without installing dependencies', linux, async t => {
  const f = await fixture(t); await previous(f.dir);
  assert.equal(f.run().status, 0);
  const r = f.run('rollback', old); assert.equal(r.status, 0, r.stderr);
  assert.equal(await readlink(join(f.dir, 'current')), join(f.dir, 'releases', old));
});
