import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = new URL('.', import.meta.url);
const entry = process.argv[2] === '--staging' ? 'staging' : 'worker';
mkdirSync(new URL('.bundle/', directory), { recursive: true });
const result = spawnSync('pnpm', [
  'dlx', 'esbuild@0.25.4', `${entry}.mjs`,
  '--external:class-transformer', '--external:class-validator',
  '--external:@nestjs/websockets/*', '--external:@nestjs/microservices',
  '--external:@nestjs/microservices/*', '--external:pg-native', '--log-limit=0',
  '--bundle', '--platform=node', '--conditions=workerd', '--format=esm', '--external:cloudflare:*',
  '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  `--outfile=.bundle/${entry}.mjs`,
], { cwd: fileURLToPath(directory), stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
