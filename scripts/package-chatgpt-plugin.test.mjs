import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(root, 'scripts/package-chatgpt-plugin.mjs');
const run = (origin, out) => spawnSync(process.execPath, [script, '--origin', origin, '--out', out], { encoding: 'utf8' });
test('packages exactly one branded plugin with scoped OAuth and no bundled credentials', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sportos-package-test-'));
  try {
    const out = resolve(directory, 'sportos.zip');
    const result = run('https://api.sportos.example', out); assert.equal(result.status, 0, result.stderr);
    const json = name => JSON.parse(spawnSync('unzip', ['-p', out, `sportos/${name}`], { encoding: 'utf8' }).stdout);
    const plugin = json('plugin.json'), mcp = json('mcp.json');
    assert.equal(plugin.name, 'sportos'); assert.equal(plugin.extensions['com.openai'].interface.displayName, 'SportOS');
    assert.ok(plugin.extensions['com.openai'].interface.shortDescription.length <= 30);
    assert.deepEqual(mcp.mcpServers.sportos, { type: 'streamable-http', url: 'https://api.sportos.example/mcp', extensions: {
      'com.openai': { auth: { type: 'oauth', client: { mode: 'provided', clientId: 'sportos-chatgpt', tokenEndpointAuthMethod: 'none' }, baseScopes: ['athlete:read'], defaultScopes: ['athlete:read'] } },
    } });
    const names = spawnSync('unzip', ['-Z1', out], { encoding: 'utf8' }).stdout.split('\n').filter(x => x && !x.endsWith('/')).sort();
    assert.deepEqual(names, ['sportos/assets/icon.png', 'sportos/mcp.json', 'sportos/plugin.json', 'sportos/skills/athlete-chat/SKILL.md']);
    const before = await readFile(out);
    assert.notEqual(run('https://api.sportos.example', out).status, 0);
    assert.deepEqual(await readFile(out), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('rejects insecure or ambiguous origins and refuses tracked output', () => {
  for (const origin of ['http://api.example', 'https://u:p@api.example', 'https://api.example/', 'https://api.example/mcp', 'https://api.example?token=fixture', 'https://api.example#fragment']) {
    assert.notEqual(run(origin, '/tmp/sportos-invalid-should-not-exist.zip').status, 0);
  }
  assert.notEqual(run('https://api.sportos.example', resolve(root, 'sportos-should-not-exist.zip')).status, 0);
});
