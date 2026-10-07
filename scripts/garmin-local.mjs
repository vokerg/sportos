import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const garminHome = join(homedir(), '.local', 'share', 'sportos', 'garmin');
const venv = join(garminHome, 'venv');
const python = join(venv, 'bin', 'python');
const command = process.argv[2];
const args = process.argv.slice(3).filter((arg) => arg !== '--');
function run(executable, parameters) {
  const result = spawnSync(executable, parameters, { stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (result.error) { console.error('Garmin local tool could not start. Check Python 3.12+ and run pnpm garmin:setup.'); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (command === 'setup') {
  for (let path = garminHome; path !== dirname(path); path = dirname(path)) if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Garmin tool directory must not contain symlinks.');
  mkdirSync(garminHome, { recursive: true, mode: 0o700 }); chmodSync(garminHome, 0o700);
  if (!existsSync(python)) run('python3', ['-m', 'venv', venv]);
  run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', join(repo, 'tools/garmin/requirements.txt')]);
} else if (['login', 'activity', 'test'].includes(command)) {
  if (!existsSync(python)) { console.error('Run pnpm garmin:setup first.'); process.exit(1); }
  run(python, command === 'test' ? ['-m', 'unittest', 'discover', '-s', join(repo, 'tools/garmin'), '-p', 'test_*.py']
    : [join(repo, 'tools/garmin/extract_activity.py'), command, ...args]);
} else { console.error('Use pnpm garmin:setup, garmin:login, garmin:activity or garmin:test.'); process.exit(1); }
