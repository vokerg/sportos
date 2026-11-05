import { readFile, mkdir, copyFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// No credentials are accepted. Only an origin and a private output archive path.
const args = process.argv.slice(2).filter(v => v !== '--');
if (args.length !== 4 || !['--origin', '--app-id'].includes(args[0]) || args[2] !== '--out') {
  throw Error('Usage: pnpm plugin:package -- (--origin https://<render-api-host> | --app-id VERIFIED_APP_ID) --out /private/path/sportos.zip');
}
const appId = args[0] === '--app-id' ? args[1] : null;
const origin = args[0] === '--origin' ? new URL(args[1]) : null;
if (origin && (origin.protocol !== 'https:' || origin.origin !== args[1] || origin.username || origin.password)) {
  throw Error('Use an exact HTTPS API origin, without a path, credentials or query.');
}
if (appId && !/^(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9][A-Za-z0-9_-]*$/.test(appId)) {
  throw Error('Use the verified backend App ID, not a plugin ID or URL.');
}
const out = resolve(args[3]);
const rel = relative(root, out);
if ((!rel.startsWith('..' + '/') && !isAbsolute(rel)) || !out.endsWith('.zip')) {
  throw Error('Write the ZIP outside the repository to keep deployment inventory private.');
}
const source = resolve(root, 'plugins/sportos');
const manifest = JSON.parse(await readFile(resolve(source, 'plugin.json'), 'utf8'));
if (manifest.name !== 'sportos' || manifest.extensions['com.openai'].interface.shortDescription.length > 30) {
  throw Error('Plugin identity or subtitle is invalid.');
}
const work = await mkdtemp(resolve(tmpdir(), 'sportos-plugin-'));
try {
  const plugin = resolve(work, 'sportos');
  await mkdir(resolve(plugin, 'assets'), { recursive: true });
  await mkdir(resolve(plugin, 'skills/athlete-chat'), { recursive: true });
  for (const file of ['plugin.json', 'assets/icon.png', 'skills/athlete-chat/SKILL.md']) {
    await copyFile(resolve(source, file), resolve(plugin, file));
  }
  if (appId) {
    manifest.extensions['com.openai'].apps = './.app.json';
    await writeFile(resolve(plugin, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(resolve(plugin, '.app.json'), JSON.stringify({ apps: { 'sportos-mcp': { id: appId } } }, null, 2) + '\n');
  } else await writeFile(resolve(plugin, 'mcp.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: { sportos: {
      type: 'streamable-http', url: `${origin.origin}/mcp`,
      extensions: { 'com.openai': { auth: {
        type: 'oauth', client: { mode: 'provided', clientId: 'sportos-chatgpt', tokenEndpointAuthMethod: 'none' },
        baseScopes: ['athlete:read'], defaultScopes: ['athlete:read'],
      } } },
    } },
  }, null, 2) + '\n');
  await mkdir(dirname(out), { recursive: true });
  // Refuse to update an old ZIP and accidentally preserve stale/unrelated members.
  const { open } = await import('node:fs/promises');
  const reserve = await open(out, 'wx'); await reserve.close(); await rm(out);
  const zip = spawnSync('zip', ['-q', '-r', out, 'sportos'], { cwd: work, encoding: 'utf8' });
  if (zip.status !== 0) throw Error('ZIP creation failed. Install zip and retry with a fresh output path.');
  const listing = spawnSync('unzip', ['-Z1', out], { encoding: 'utf8' });
  const files = listing.stdout.split('\n').filter(s => s && !s.endsWith('/')).sort();
  const expected = [`sportos/${appId ? '.app.json' : 'mcp.json'}`, 'sportos/assets/icon.png', 'sportos/plugin.json', 'sportos/skills/athlete-chat/SKILL.md'].sort();
  if (listing.status !== 0 || JSON.stringify(files) !== JSON.stringify(expected)) throw Error('Unexpected archive contents.');
  for (const file of ['plugin.json', appId ? '.app.json' : 'mcp.json']) {
    const content = spawnSync('unzip', ['-p', out, `sportos/${file}`], { encoding: 'utf8' });
    JSON.parse(content.stdout);
  }
  console.log('SportOS private plugin archive created and inspected. No server was deployed or plugin installed.');
} finally { await rm(work, { recursive: true, force: true }); }
