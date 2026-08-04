import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import { AuthRepository, ExternalIdentityClaimError } from './auth.repository.js';
import { ImportJobsRepository } from './import-jobs.repository.js';
import { UploadsRepository } from './uploads.repository.js';

const ownerDatabaseUrl = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const databaseDescribe = ownerDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

const metricDate = '2097-08-01';

databaseDescribe('account ownership database integration', () => {
  let db: TestDatabase;
  const accountIds: string[] = [];

  beforeAll(() => { db = createDb(requireOwnerDatabaseUrl()); });

  afterAll(async () => {
    if (!db) return;
    for (const accountId of accountIds) await cleanupOwner(db, accountId);
    if (accountIds.length > 0) await db.deleteFrom('accounts').where('id', 'in', accountIds).execute();
    await db.destroy();
  });

  it('isolates reads, permits same business identities, rejects foreign links, and prevents owner reassignment', async () => {
    const accountA = await createAccount(db, 'Owner A');
    const accountB = await createAccount(db, 'Owner B');
    accountIds.push(accountA, accountB);

    await withAccountContext(db, accountA, async (ownerDb) => {
      await ownerDb.insertInto('daily_metrics').values(dailyRow(111)).execute();
      await ownerDb.insertInto('scoring_rules').values(ruleRow('shared-rule')).execute();
    });
    await withAccountContext(db, accountB, async (ownerDb) => {
      await ownerDb.insertInto('daily_metrics').values(dailyRow(222)).execute();
      await ownerDb.insertInto('scoring_rules').values(ruleRow('shared-rule')).execute();
    });

    const aDaily = await withAccountContext(db, accountA, (ownerDb) => ownerDb.selectFrom('daily_metrics').selectAll().execute());
    const bDaily = await withAccountContext(db, accountB, (ownerDb) => ownerDb.selectFrom('daily_metrics').selectAll().execute());
    expect(aDaily).toHaveLength(1);
    expect(aDaily[0]?.total_points).toBe(111);
    expect(bDaily).toHaveLength(1);
    expect(bDaily[0]?.total_points).toBe(222);

    const noContextRows = await db.selectFrom('daily_metrics').selectAll().execute();
    expect(noContextRows).toEqual([]);

    await expect(withAccountContext(db, accountA, (ownerDb) => ownerDb
      .updateTable('daily_metrics')
      .set({ owner_id: accountB })
      .where('metric_date', '=', metricDate)
      .execute())).rejects.toThrow(/owner_id is immutable/);

    const uploadId = randomUUID();
    const job = await withAccountContext(db, accountA, async (ownerDb) => {
      await new UploadsRepository(ownerDb).create({
        id: uploadId,
        workbook_kind: 'my_sport',
        storage_provider: 'local',
        object_key: `ownership/${uploadId}`,
        original_filename: 'private-a.xlsx',
        sanitized_filename: 'private-a.xlsx',
        content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byte_size: 128,
        sha256: 'a'.repeat(64),
        status: 'stored',
        last_error: null,
        imported_at: null,
        deleted_at: null,
      });
      return new ImportJobsRepository(ownerDb).enqueue(uploadId);
    });

    const foreignJob = await withAccountContext(db, accountB, (ownerDb) => new ImportJobsRepository(ownerDb).getById(job.id));
    const foreignDuplicate = await withAccountContext(db, accountB, (ownerDb) => new UploadsRepository(ownerDb).findDuplicate('a'.repeat(64), 'my_sport'));
    expect(foreignJob).toBeNull();
    expect(foreignDuplicate).toBeNull();

    await expect(withAccountContext(db, accountB, (ownerDb) => ownerDb.insertInto('import_jobs').values({
      uploaded_file_id: uploadId,
      import_batch_id: null,
      status: 'queued',
      phase: 'queued',
      progress_percent: 0,
      attempt_count: 0,
      max_attempts: 3,
      lease_owner: null,
      lease_expires_at: null,
      heartbeat_at: null,
      cancellation_requested_at: null,
      next_attempt_at: new Date(),
      error_code: null,
      error_message: null,
      result_json: {},
      started_at: null,
      completed_at: null,
    }).execute())).rejects.toThrow();
  });

  it('atomically claims one configured account for an external identity and seeds its rule template', async () => {
    const accountId = await createAccount(db, 'Migrated owner');
    accountIds.push(accountId);
    const auth = new AuthRepository(db);
    const issuer = `https://issuer-${randomUUID()}.example`;
    const subject = `subject-${randomUUID()}`;

    const claimed = await auth.provisionExternalIdentity({
      issuer,
      subject,
      email: 'owner@example.test',
      displayName: 'Migrated athlete',
      preferredAccountId: accountId,
    });
    expect(claimed).toMatchObject({ id: accountId, display_name: 'Migrated athlete', email: 'owner@example.test' });

    const repeated = await auth.provisionExternalIdentity({ issuer, subject, displayName: 'Updated athlete' });
    expect(repeated).toMatchObject({ id: accountId, display_name: 'Updated athlete' });

    await expect(auth.provisionExternalIdentity({
      issuer,
      subject: `other-${randomUUID()}`,
      preferredAccountId: accountId,
    })).rejects.toBeInstanceOf(ExternalIdentityClaimError);

    const rules = await withAccountContext(db, accountId, (ownerDb) => ownerDb
      .selectFrom('scoring_rules')
      .select(['code', 'version'])
      .orderBy('code')
      .execute());
    expect(rules.length).toBeGreaterThan(0);
  });
});

async function createAccount(db: TestDatabase, displayName: string): Promise<string> {
  const row = await db.insertInto('accounts').values({ display_name: displayName, email: null, status: 'active' })
    .returning('id').executeTakeFirstOrThrow();
  return row.id;
}

function dailyRow(total: number) {
  return {
    metric_date: metricDate,
    source_record_id: null,
    steps: 0,
    run_m: 0,
    bike_m: 0,
    swim_m: 0,
    workout_points: 0,
    power_points: 0,
    base_points: total,
    bonus_points: 0,
    total_points: total,
    excel_all_points: null,
    excel_row_hash: null,
  };
}

function ruleRow(code: string) {
  return {
    code,
    version: 1,
    supersedes_rule_id: null,
    name: 'Shared name',
    activity_type: 'run' as const,
    rule_kind: 'coefficient' as const,
    metric: 'distance_m',
    coefficient: 1,
    threshold_operator: null,
    threshold_value: null,
    threshold_unit: null,
    points: null,
    valid_from: '2097-01-01',
    valid_to: null,
    priority: 100,
    enabled: true,
    description: null,
  };
}

async function cleanupOwner(db: TestDatabase, accountId: string): Promise<void> {
  await withAccountContext(db, accountId, async (ownerDb) => {
    await ownerDb.deleteFrom('import_jobs').execute();
    await ownerDb.deleteFrom('score_ledger').execute();
    await ownerDb.deleteFrom('performance_events').execute();
    await ownerDb.deleteFrom('daily_metrics').execute();
    await ownerDb.deleteFrom('activities').execute();
    await ownerDb.deleteFrom('source_records').execute();
    await ownerDb.deleteFrom('import_batches').execute();
    await ownerDb.deleteFrom('uploaded_files').execute();
    await ownerDb.deleteFrom('scoring_rule_changes').execute();
    await ownerDb.deleteFrom('scoring_rules').execute();
  });
}

function requireOwnerDatabaseUrl(): string {
  if (!ownerDatabaseUrl) throw new Error('SPORTOS_OWNER_TEST_DATABASE_URL is required.');
  return ownerDatabaseUrl;
}
