import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(repoRoot, '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const [command = 'info', ...arguments_] = process.argv.slice(2);
const supportedCommands = new Set(['info', 'migrate', 'validate', 'repair']);
if (!supportedCommands.has(command)) {
  console.error(`Unsupported migration command: ${command}`);
  console.error(`Supported commands: ${[...supportedCommands].join(', ')}`);
  process.exit(1);
}

const databaseUrl = process.env.SPORTOS_FLYWAY_URL?.trim() || process.env.FLYWAY_URL?.trim();
const user = process.env.SPORTOS_FLYWAY_USER?.trim() || process.env.FLYWAY_USER?.trim();
const password = process.env.SPORTOS_FLYWAY_PASSWORD ?? process.env.FLYWAY_PASSWORD;

if (!databaseUrl || !user || !password) {
  console.error('Neon schema-owner migration settings are required: SPORTOS_FLYWAY_URL, SPORTOS_FLYWAY_USER, and SPORTOS_FLYWAY_PASSWORD.');
  process.exit(1);
}
assertNeonDatabaseUrl(databaseUrl);

const environment = {
  ...process.env,
  FLYWAY_URL: toJdbcUrl(databaseUrl),
  FLYWAY_USER: user,
  FLYWAY_PASSWORD: password,
  FLYWAY_LOCATIONS: `filesystem:${resolve(repoRoot, 'flyway/sql')}`,
};
const executable = process.platform === 'win32' ? 'flyway.cmd' : 'flyway';
const result = spawnSync(executable, [command, ...arguments_], {
  cwd: repoRoot,
  env: environment,
  stdio: 'inherit',
});

if (result.error?.code === 'ENOENT') {
  console.error('Flyway CLI is required and must be available on PATH for Neon migrations.');
  process.exit(1);
}
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

function toJdbcUrl(value) {
  return value.startsWith('jdbc:') ? value : `jdbc:${value}`;
}

function assertNeonDatabaseUrl(value) {
  const url = value.startsWith('jdbc:') ? value.slice('jdbc:'.length) : value;
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    console.error('SPORTOS_FLYWAY_URL must be a valid PostgreSQL URL for Neon.');
    process.exit(1);
  }

  if (hostname !== 'neon.tech' && !hostname.endsWith('.neon.tech')) {
    console.error('SPORTOS_FLYWAY_URL must point to a Neon host (*.neon.tech).');
    process.exit(1);
  }
}
