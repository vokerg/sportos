import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createDb } from '@sportos/db';
import { LocalUploadStorage } from '@sportos/importers';
import { ImportJobRunner } from './import-job-runner.js';

const concurrency = clampInteger(Number(process.env.IMPORT_WORKER_CONCURRENCY ?? 1), 1, 4);
const leaseSeconds = clampInteger(Number(process.env.IMPORT_JOB_LEASE_SECONDS ?? 60), 15, 600);
const pollIntervalMs = clampInteger(Number(process.env.IMPORT_JOB_POLL_MS ?? 1000), 100, 60_000);
const processId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const controller = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => controller.abort());
}

const db = createDb();
const storage = new LocalUploadStorage();

try {
  await Promise.all(
    Array.from({ length: concurrency }, (_, index) => new ImportJobRunner(db, {
      workerId: `${processId}:${index + 1}`,
      leaseSeconds,
      pollIntervalMs,
    }, storage).run(controller.signal)),
  );
} finally {
  await db.destroy();
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
