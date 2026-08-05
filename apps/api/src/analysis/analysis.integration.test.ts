import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AnalysisAuditRepository,
  createDb,
  withAccountContext,
  type Database,
  type Kysely,
} from '@sportos/db';
import type { DbProvider } from '../db.provider.js';
import { DailyService } from '../daily/daily.service.js';
import { DeterministicAnalysisTextGenerator } from './analysis.model.js';
import { AnalysisService } from './analysis.service.js';
import { AnalysisToolService } from './analysis-tool.service.js';

const databaseUrl = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
type TestDb = ReturnType<typeof createDb>;

const metricDate = '2096-08-05';

databaseDescribe('analysis owner isolation integration', () => {
  let db: TestDb;

  beforeAll(() => { db = createDb(requireDatabaseUrl()); });
  afterAll(async () => { if (db) await db.destroy(); });

  it('uses only the authenticated account context and isolates audit/source identifiers', async () => {
    const accountA = await createAccount(db, 'Analysis A');
    const accountB = await createAccount(db, 'Analysis B');
    await withAccountContext(db, accountA, (ownerDb) => ownerDb.insertInto('daily_metrics').values(dailyRow(111)).execute());
    await withAccountContext(db, accountB, (ownerDb) => ownerDb.insertInto('daily_metrics').values(dailyRow(222)).execute());

    const dbProvider = {
      db,
      withAccount<T>(accountId: string, callback: (ownerDb: Kysely<Database>) => Promise<T>): Promise<T> {
        return withAccountContext(db, accountId, callback);
      },
    } as unknown as DbProvider;
    const dailyService = new DailyService(dbProvider);
    const service = new AnalysisService(
      new AnalysisToolService(dailyService),
      dbProvider,
      new DeterministicAnalysisTextGenerator(),
    );

    const request = {
      question: 'What is the official total?',
      toolRequest: { tool: 'daily_summary' as const, input: { from: metricDate, to: metricDate, limit: 1 } },
    };
    const answerA = await service.answer(request, accountA);
    const answerB = await service.answer(request, accountB);
    if (answerA.officialRecord?.tool !== 'daily_summary' || answerB.officialRecord?.tool !== 'daily_summary') {
      throw new Error('Expected daily summary records.');
    }
    expect(answerA.officialRecord.facts.days[0]?.score.officialTotal).toBe(111);
    expect(answerB.officialRecord.facts.days[0]?.score.officialTotal).toBe(222);

    const auditA = await withAccountContext(db, accountA, (ownerDb) => new AnalysisAuditRepository(ownerDb).listRecent());
    const auditB = await withAccountContext(db, accountB, (ownerDb) => new AnalysisAuditRepository(ownerDb).listRecent());
    expect(auditA).toHaveLength(1);
    expect(auditB).toHaveLength(1);
    expect(auditA[0]?.id).toBe(answerA.auditId);
    expect(auditB[0]?.id).toBe(answerB.auditId);
    expect(auditA[0]?.questionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(auditA)).not.toContain(request.question);
    expect(await db.selectFrom('analysis_runs').selectAll().execute()).toEqual([]);
  });
});

async function createAccount(db: TestDb, displayName: string): Promise<string> {
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

function requireDatabaseUrl(): string {
  if (!databaseUrl) throw new Error('SPORTOS_OWNER_TEST_DATABASE_URL is required.');
  return databaseUrl;
}
