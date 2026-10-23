import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { supervise } from './dev-supervisor.mjs';

function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const children = [];
  const signals = [];
  const service = supervise('test', [], {
    label: 'test',
    spawnProcess: () => { const child = new EventEmitter(); children.push(child); return child; },
    terminate: (child, signal) => signals.push([child, signal]),
  });
  return { service, children, signals };
}

test('unexpected exits restart with bounded backoff; a stable runtime resets it', async (t) => {
  const { service, children } = harness(t);
  for (const ms of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const count = children.length;
    children.at(-1).emit('exit', 1);
    t.mock.timers.tick(ms - 1);
    assert.equal(children.length, count);
    t.mock.timers.tick(1);
    assert.equal(children.length, count + 1);
  }
  t.mock.timers.tick(30_000);
  children.at(-1).emit('exit', 1);
  const count = children.length;
  t.mock.timers.tick(1000);
  assert.equal(children.length, count + 1);
  const stopped = service.stop();
  children.at(-1).emit('exit', null, 'SIGTERM');
  await stopped;
  t.mock.timers.tick(60_000);
  assert.equal(children.length, count + 1);
});

test('error followed by exit schedules one restart; stop cancels pending restart', async (t) => {
  const { service, children } = harness(t);
  children[0].emit('error', new Error('private environment data'));
  children[0].emit('exit', 1);
  t.mock.timers.tick(1000);
  assert.equal(children.length, 2);
  children[1].emit('exit', 1);
  await service.stop();
  t.mock.timers.tick(60_000);
  assert.equal(children.length, 2);
});

test('reload retires the process tree, deduplicates events, and restarts immediately', async (t) => {
  const { service, children, signals } = harness(t);
  service.restart();
  service.restart();
  assert.equal(signals.filter(([, signal]) => signal === 'SIGTERM').length, 1);
  children[0].emit('exit', 0);
  t.mock.timers.tick(0);
  assert.equal(children.length, 2);
  const stopped = service.stop();
  t.mock.timers.tick(5000);
  assert.deepEqual(signals.at(-1), [children[1], 'SIGKILL']);
  children[1].emit('exit', null, 'SIGKILL');
  await stopped;
});

test('restarts a real crashed Node runtime and stops its replacement', async (t) => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'sportos-recovery-'));
  const marker = join(directory, 'started');
  const service = supervise(process.execPath, ['--input-type=module', '-e', `
    import { existsSync, writeFileSync } from 'node:fs';
    const marker = process.argv[1];
    if (!existsSync(marker)) { writeFileSync(marker, 'first'); process.exit(1); }
    writeFileSync(marker, String(process.pid));
    setInterval(() => {}, 1000);
  `, marker], { label: 'fixture', restartDelayMs: 10 });
  t.after(async () => { await service.stop(); await rm(directory, { recursive: true, force: true }); });
  let pid;
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await readFile(marker, 'utf8').catch(() => '');
    if (/^\d+$/.test(value)) { pid = Number(value); break; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(pid, 'replacement started');
  await service.stop();
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
