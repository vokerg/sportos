import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, symlink, readFile, stat, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { privateDestination, writePrivateArtifacts } from './private-artifacts.js';
import { athleteSnapshotSchema } from './contracts.js';
import { buildAthleteSnapshot } from '@sportos/analytics';
const roots: string[] = [];
const root = async () => {
  const p = await mkdtemp(join(tmpdir(), 'sportos-private-test-'));
  roots.push(p);
  return p;
};
afterEach(async () => {
  for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true });
});
describe('private handoff writer', () => {
  it('rejects worktrees, ignored paths, Git metadata, bare repos and symlink destinations', async () => {
    const p = await root(),
      repo = join(p, 'repo');
    await mkdir(repo);
    execFileSync('git', ['init', '-q', repo]);
    await expect(privateDestination(join(repo, 'ignored', 'new'))).rejects.toThrow('Git');
    await expect(privateDestination(join(repo, '.git', 'private'))).rejects.toThrow('Git');
    const link = join(p, 'link');
    await symlink(repo, link);
    await expect(privateDestination(join(link, 'data'))).rejects.toThrow('Git');
    const bare = join(p, 'bare');
    execFileSync('git', ['init', '--bare', '-q', bare]);
    await expect(privateDestination(join(bare, 'data'))).rejects.toThrow('Git');
    await expect(privateDestination(resolve('../../private'))).rejects.toThrow('Git');
  });
  it('writes a restricted atomic validated pair, 20 Russian chapters and a matching manifest', async () => {
    const p = await root();
    const snapshot = athleteSnapshotSchema.parse(
      buildAthleteSnapshot({
        activities: [],
        supplements: [],
        runningBests: [],
        recentRunningBests: [],
        asOfDate: '2026-10-28',
        timezone: 'Europe/Copenhagen',
        generatedAt: '2026-10-28T12:00:00.000Z',
      }),
    );
    const output = await writePrivateArtifacts(snapshot, join(p, 'safe'));
    const json = await readFile(output.snapshotPath, 'utf8'),
      report = await readFile(output.reportPath, 'utf8'),
      manifest = JSON.parse(await readFile(output.manifestPath, 'utf8'));
    expect(JSON.parse(json)).toEqual(snapshot);
    expect(report.match(/^## \d+\./gm)).toHaveLength(20);
    expect(report).toContain('Триатлон');
    expect(report).not.toContain('undefined');
    for (const f of manifest.files) {
      const content = await readFile(join(output.directory, f.name));
      expect(createHash('sha256').update(content).digest('hex')).toBe(f.sha256);
      expect((await stat(join(output.directory, f.name))).mode & 0o777).toBe(0o600);
    }
    expect((await stat(output.directory)).mode & 0o777).toBe(0o700);
    expect((await readdir(output.directory)).some((f) => f.endsWith('.tmp'))).toBe(false);
  });
});
