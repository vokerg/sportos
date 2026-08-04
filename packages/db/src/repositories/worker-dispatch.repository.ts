import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

export interface DispatchedImportJob {
  id: string;
  ownerId: string;
  uploadId: string;
  objectKey: string;
  filename: string;
  workbookKind: 'my_sport' | 'run_db';
  sha256: string;
  attemptCount: number;
  maxAttempts: number;
}

export interface DispatchedRuleChange {
  id: string;
  ownerId: string;
  previousRuleId: string | null;
  proposedRuleId: string;
  affectedFrom: string;
  affectedTo: string;
  attemptCount: number;
  maxAttempts: number;
}

export interface StaleRecoveryCounts {
  requeued: number;
  failed: number;
  cancelled: number;
}

export class WorkerDispatchRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async recoverStaleImports(limit = 100): Promise<StaleRecoveryCounts> {
    return this.db.transaction().execute(async (transaction) => {
      const stale = await transaction
        .selectFrom('import_jobs')
        .select(['id', 'attempt_count', 'max_attempts', 'cancellation_requested_at'])
        .where('status', '=', 'running')
        .where('lease_expires_at', '<', new Date())
        .orderBy('lease_expires_at', 'asc')
        .limit(clampInteger(limit, 1, 1000))
        .forUpdate()
        .skipLocked()
        .execute();

      const counts = emptyCounts();
      for (const job of stale) {
        if (job.cancellation_requested_at !== null) {
          await transaction.updateTable('import_jobs').set(importTerminal('cancelled', null, null)).where('id', '=', job.id).execute();
          counts.cancelled += 1;
        } else if (job.attempt_count >= job.max_attempts) {
          await transaction.updateTable('import_jobs').set(importTerminal(
            'failed',
            'STALE_LEASE',
            'Worker lease expired after the final attempt.',
          )).where('id', '=', job.id).execute();
          counts.failed += 1;
        } else {
          await transaction.updateTable('import_jobs').set({
            status: 'queued',
            phase: 'recovered',
            lease_owner: null,
            lease_expires_at: null,
            heartbeat_at: null,
            next_attempt_at: new Date(),
            updated_at: new Date(),
            error_code: 'STALE_LEASE_RECOVERED',
            error_message: 'The previous worker lease expired; the job was safely requeued.',
          }).where('id', '=', job.id).execute();
          counts.requeued += 1;
        }
      }
      return counts;
    });
  }

  async claimImport(workerId: string, leaseSeconds = 60): Promise<DispatchedImportJob | null> {
    const safeWorkerId = safeText(workerId, 200, 'sportos-worker');
    const boundedLease = clampInteger(leaseSeconds, 15, 600);
    return this.db.transaction().execute(async (transaction) => {
      const candidate = await transaction
        .selectFrom('import_jobs as job')
        .innerJoin('uploaded_files as upload', (join) => join
          .onRef('upload.owner_id', '=', 'job.owner_id')
          .onRef('upload.id', '=', 'job.uploaded_file_id'))
        .select([
          'job.id',
          'job.owner_id',
          'job.uploaded_file_id',
          'job.attempt_count',
          'job.max_attempts',
          'upload.object_key',
          'upload.sanitized_filename',
          'upload.workbook_kind',
          'upload.sha256',
        ])
        .where('job.status', '=', 'queued')
        .where('job.next_attempt_at', '<=', new Date())
        .where('job.cancellation_requested_at', 'is', null)
        .where('upload.deleted_at', 'is', null)
        .orderBy('job.created_at', 'asc')
        .orderBy('job.id', 'asc')
        .forUpdate('job')
        .skipLocked()
        .executeTakeFirst();
      if (!candidate) return null;

      const updated = await transaction.updateTable('import_jobs').set({
        status: 'running',
        phase: 'claimed',
        progress_percent: 5,
        attempt_count: sql<number>`attempt_count + 1`,
        lease_owner: safeWorkerId,
        lease_expires_at: sql<Date>`now() + make_interval(secs => ${boundedLease})`,
        heartbeat_at: new Date(),
        updated_at: new Date(),
        started_at: sql<Date>`coalesce(started_at, now())`,
        completed_at: null,
        error_code: null,
        error_message: null,
      })
        .where('id', '=', candidate.id)
        .where('owner_id', '=', candidate.owner_id)
        .where('status', '=', 'queued')
        .returning(['attempt_count', 'max_attempts'])
        .executeTakeFirst();
      if (!updated) return null;

      return {
        id: candidate.id,
        ownerId: candidate.owner_id,
        uploadId: candidate.uploaded_file_id,
        objectKey: candidate.object_key,
        filename: safeFilename(candidate.sanitized_filename),
        workbookKind: candidate.workbook_kind,
        sha256: candidate.sha256,
        attemptCount: updated.attempt_count,
        maxAttempts: updated.max_attempts,
      };
    });
  }

  async recoverStaleRuleChanges(limit = 100): Promise<StaleRecoveryCounts> {
    return this.db.transaction().execute(async (transaction) => {
      const stale = await transaction
        .selectFrom('scoring_rule_changes')
        .select(['id', 'attempt_count', 'max_attempts', 'cancellation_requested_at'])
        .where('status', '=', 'running')
        .where('lease_expires_at', '<', new Date())
        .orderBy('lease_expires_at', 'asc')
        .limit(clampInteger(limit, 1, 1000))
        .forUpdate()
        .skipLocked()
        .execute();

      const counts = emptyCounts();
      for (const change of stale) {
        if (change.cancellation_requested_at !== null) {
          await transaction.updateTable('scoring_rule_changes').set(ruleTerminal('cancelled', null, null)).where('id', '=', change.id).execute();
          counts.cancelled += 1;
        } else if (change.attempt_count >= change.max_attempts) {
          await transaction.updateTable('scoring_rule_changes').set(ruleTerminal(
            'failed',
            'STALE_LEASE',
            'Worker lease expired after the final attempt.',
          )).where('id', '=', change.id).execute();
          counts.failed += 1;
        } else {
          await transaction.updateTable('scoring_rule_changes').set({
            status: 'queued',
            phase: 'recovered',
            lease_owner: null,
            lease_expires_at: null,
            heartbeat_at: null,
            next_attempt_at: new Date(),
            updated_at: new Date(),
            error_code: 'STALE_LEASE_RECOVERED',
            error_message: 'The previous worker lease expired; the change was safely requeued.',
          }).where('id', '=', change.id).execute();
          counts.requeued += 1;
        }
      }
      return counts;
    });
  }

  async claimRuleChange(workerId: string, leaseSeconds = 60): Promise<DispatchedRuleChange | null> {
    const safeWorkerId = safeText(workerId, 200, 'sportos-rule-worker');
    const boundedLease = clampInteger(leaseSeconds, 15, 600);
    return this.db.transaction().execute(async (transaction) => {
      const candidate = await transaction
        .selectFrom('scoring_rule_changes')
        .select([
          'id',
          'owner_id',
          'previous_rule_id',
          'proposed_rule_id',
          'affected_from',
          'affected_to',
        ])
        .where('status', '=', 'queued')
        .where('next_attempt_at', '<=', new Date())
        .where('cancellation_requested_at', 'is', null)
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!candidate) return null;

      const updated = await transaction.updateTable('scoring_rule_changes').set({
        status: 'running',
        phase: 'claimed',
        progress_percent: 5,
        attempt_count: sql<number>`attempt_count + 1`,
        lease_owner: safeWorkerId,
        lease_expires_at: sql<Date>`now() + make_interval(secs => ${boundedLease})`,
        heartbeat_at: new Date(),
        updated_at: new Date(),
        started_at: sql<Date>`coalesce(started_at, now())`,
        completed_at: null,
        error_code: null,
        error_message: null,
      })
        .where('id', '=', candidate.id)
        .where('owner_id', '=', candidate.owner_id)
        .where('status', '=', 'queued')
        .returning(['attempt_count', 'max_attempts'])
        .executeTakeFirst();
      if (!updated) return null;

      return {
        id: candidate.id,
        ownerId: candidate.owner_id,
        previousRuleId: candidate.previous_rule_id,
        proposedRuleId: candidate.proposed_rule_id,
        affectedFrom: dateString(candidate.affected_from),
        affectedTo: dateString(candidate.affected_to),
        attemptCount: updated.attempt_count,
        maxAttempts: updated.max_attempts,
      };
    });
  }
}

function importTerminal(
  status: 'failed' | 'cancelled',
  errorCode: string | null,
  errorMessage: string | null,
) {
  return {
    status,
    phase: status,
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: new Date(),
    completed_at: new Date(),
    updated_at: new Date(),
    error_code: errorCode,
    error_message: errorMessage,
  } as const;
}

function ruleTerminal(
  status: 'failed' | 'cancelled',
  errorCode: string | null,
  errorMessage: string | null,
) {
  return {
    status,
    phase: status,
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: new Date(),
    completed_at: new Date(),
    updated_at: new Date(),
    error_code: errorCode,
    error_message: errorMessage,
  } as const;
}

function emptyCounts(): StaleRecoveryCounts {
  return { requeued: 0, failed: 0, cancelled: 0 };
}

function safeFilename(filename: string): string {
  const value = filename.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)?.trim();
  return (value || 'workbook.xlsx').slice(0, 255);
}

function safeText(value: string, maximum: number, fallback: string): string {
  return value.trim().slice(0, maximum) || fallback;
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
