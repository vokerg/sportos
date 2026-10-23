import { spawn, spawnSync } from 'node:child_process';

/** Own each runtime process tree; watchers alone do not restart crashed apps. */
export function supervise(command, args, {
  cwd, env = process.env, label, spawnProcess = spawn,
  restartDelayMs = 1000, maxRestartDelayMs = 30_000, stableMs = 30_000,
  killAfterMs = 5000,
  terminate = (child, signal) => {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  },
} = {}) {
  let child;
  let stopping = false;
  let restartRequested = false;
  let failures = 0;
  let restartTimer;
  let killTimer;
  let resolveStopped;
  const stopped = new Promise((resolve) => { resolveStopped = resolve; });

  function launch() {
    if (stopping) return;
    restartTimer = undefined;
    const startedAt = Date.now();
    let settled = false;
    try {
      child = spawnProcess(command, args, {
        cwd, env, stdio: 'inherit', shell: process.platform === 'win32', detached: process.platform !== 'win32',
      });
      child.once('error', () => finish());
      child.once('exit', () => finish());
    } catch {
      finish();
    }
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      killTimer = undefined;
      // A pnpm parent can exit before its descendants. Retire the whole tree.
      if (child) terminate(child, 'SIGKILL');
      child = undefined;
      if (stopping) return resolveStopped();
      const requested = restartRequested;
      restartRequested = false;
      if (Date.now() - startedAt >= stableMs || requested) failures = 0;
      const waitMs = requested ? 0 : Math.min(maxRestartDelayMs, restartDelayMs * 2 ** Math.min(failures++, 10));
      if (!requested) console.warn(`${label} stopped; restarting in ${waitMs} ms.`);
      restartTimer = setTimeout(launch, waitMs);
    }
  }

  function stopChild() {
    if (!child) return;
    terminate(child, 'SIGTERM');
    killTimer ??= setTimeout(() => { if (child) terminate(child, 'SIGKILL'); }, killAfterMs);
  }

  launch();
  return {
    restart() {
      if (stopping || restartRequested) return;
      restartRequested = true;
      clearTimeout(restartTimer);
      if (child) stopChild();
      else { restartRequested = false; failures = 0; launch(); }
    },
    async stop() {
      if (!stopping) {
        stopping = true;
        clearTimeout(restartTimer);
        if (child) stopChild();
        else resolveStopped();
      }
      await stopped;
    },
  };
}
