import { mkdir, realpath, stat, chmod, open, rename, unlink, lstat } from 'node:fs/promises';
import { resolve, dirname, join, parse } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { athleteSnapshotSchema, type Snapshot } from './contracts.js';
import { renderReport } from './report.js';
const exec = promisify(execFile);
export async function privateDestination(destination: string): Promise<string> {
  const requested = resolve(destination);
  let existing = requested;
  const suffix: string[] = [];
  for (;;) {
    try {
      await lstat(existing);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      suffix.unshift(parse(existing).base);
      const parent = dirname(existing);
      if (parent === existing) throw Error('Invalid private destination.');
      existing = parent;
    }
  }
  const resolved = resolve(await realpath(existing), ...suffix);
  let parent = await realpath(existing);
  for (;;) {
    if (parse(parent).base === '.git') throw Error('Private output cannot be inside Git metadata.');
    try {
      await lstat(join(parent, '.git'));
      throw Error('Private output cannot be inside a Git worktree.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dirname(parent) === parent) break;
    parent = dirname(parent);
  }
  // Detect bare repos, linked worktrees and directories reached through symlinks.
  try {
    const result = await exec('git', [
      '-C',
      await realpath(existing),
      'rev-parse',
      '--is-inside-work-tree',
      '--is-bare-repository',
      '--is-inside-git-dir',
    ]);
    if (result.stdout.split(/\s+/).includes('true'))
      throw Error('Private output cannot be inside a Git repository.');
  } catch (error) {
    if (!(error as { code?: number }).code) throw error;
    if ((error as { code?: number }).code !== 128) throw error;
  }
  return resolved;
}
async function atomicFile(path: string, content: string) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
export async function writePrivateArtifacts(raw: Snapshot, destination?: string) {
  const snapshot = athleteSnapshotSchema.parse(raw);
  const date = snapshot.asOfDate;
  const requested = destination ?? join(homedir(), 'SportosPrivate', 'athlete-snapshots', date);
  const directory = await privateDestination(requested);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  if ((await privateDestination(directory)) !== directory)
    throw Error('Private destination changed during creation.');
  const snapshotName = `athlete-snapshot-${date}.json`,
    reportName = `athlete-performance-report-${date}.md`;
  const json = JSON.stringify(snapshot, null, 2) + '\n',
    report = renderReport(snapshot);
  // The manifest is the last published file: consumers verify both hashes before using a pair.
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const manifest = {
    schemaVersion: snapshot.schemaVersion,
    calculationVersion: snapshot.calculationVersion,
    generatedAt: snapshot.generatedAt,
    asOfDate: date,
    files: [
      { name: snapshotName, sha256: hash(json), bytes: Buffer.byteLength(json) },
      { name: reportName, sha256: hash(report), bytes: Buffer.byteLength(report) },
    ],
  };
  await atomicFile(join(directory, snapshotName), json);
  await atomicFile(join(directory, reportName), report);
  await atomicFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const info = await stat(directory);
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
    throw Error('Private directory permissions are too broad.');
  return {
    directory,
    snapshotPath: join(directory, snapshotName),
    reportPath: join(directory, reportName),
    manifestPath: join(directory, 'manifest.json'),
  };
}
