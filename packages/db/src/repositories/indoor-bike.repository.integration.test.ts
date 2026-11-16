import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { previewRuleChange, validateRuleProposal } from '@sportos/domain';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import { ScoringRepository } from './scoring.repository.js';
import { DailyScoringRepository } from './daily-scoring.repository.js';
import { DailyRepository } from './daily.repository.js';
import { RuleChangesRepository } from './rule-changes.repository.js';
import { WorkerDispatchRepository } from './worker-dispatch.repository.js';

const url = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration('versioned indoor bike scoring under runtime roles', () => {
  let db: ReturnType<typeof createDb>, owner: string, foreign: string;
  const date = '2094-06-10';
  beforeAll(async () => {
    if (new URL(url!).hostname !== '127.0.0.1' || !new URL(url!).pathname.endsWith('_test')) {
      throw new Error('Disposable loopback test database required.');
    }
    db = createDb(url!);
    const role = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    owner = (await db.insertInto('accounts').values({ display_name: 'Synthetic indoor owner', status: 'active', email: null }).returning('id').executeTakeFirstOrThrow()).id;
    foreign = (await db.insertInto('accounts').values({ display_name: 'Synthetic foreign', status: 'active', email: null }).returning('id').executeTakeFirstOrThrow()).id;
    await withAccountContext(db, owner, tx => sql`select sportos_seed_account_rules(${owner}::uuid)`.execute(tx));
  });
  afterAll(async () => { await db?.destroy(); });

  it('seeds the current override and preserves the null historical definition', async () => {
    const rules = await withAccountContext(db, owner, tx => new ScoringRepository(tx).listEnabledRules());
    expect(rules.find(r => r.code === 'bike.km.default')).toMatchObject({ indoorBikeCoefficient: 750, coefficient: 650 });
    const versions = await withAccountContext(db, owner, tx => new RuleChangesRepository(tx).listRuleVersions());
    expect(versions.find(r => r.code === 'bike.km.default' && !r.enabled)).toMatchObject({ indoorBikeCoefficient: undefined });
    expect(await withAccountContext(db, foreign, tx => new ScoringRepository(tx).listEnabledRules())).toEqual([]);
  });

  it('recalculates 10 km as 7,500, retains snapshots and denies foreign access', async () => {
    await withAccountContext(db, owner, async tx => {
      await tx.insertInto('daily_metrics').values({ metric_date: date, bike_m: 10000,
        base_points: 7000, bonus_points: 0, total_points: 7000, score_status: 'imported', excel_all_points: 7000 }).execute();
      await tx.insertInto('activities').values({ activity_date: date, activity_type: 'bike', subtype: 'indoor',
        source: 'strava', source_activity_id: randomUUID(), distance_m: 10000 }).execute();
    });
    const result = await withAccountContext(db, owner, tx => new DailyScoringRepository(tx).recalculateFromActivities(date));
    expect(result).toMatchObject({ scoreStatus: 'calculated', score: { baseTotal: 7500, bonusPoints: 0, appTotal: 7500 } });
    expect(result.ledger).toMatchObject([{ points: 7500, calculation: { appliedCoefficient: 750 } }]);
    const before = await withAccountContext(db, owner, tx => tx.selectFrom('daily_score_snapshots').selectAll().where('metric_date', '=', date).execute());
    await withAccountContext(db, owner, tx => new DailyScoringRepository(tx).recalculateFromActivities(date));
    const after = await withAccountContext(db, owner, tx => tx.selectFrom('daily_score_snapshots').selectAll().where('metric_date', '=', date).execute());
    for (const prior of before) expect(after.find(s => s.id === prior.id)).toEqual(prior);
    expect(await withAccountContext(db, foreign, tx => new DailyRepository(tx).getDailyScoreBreakdown(date))).toBeNull();
  });

  it('preserves the override through preview, publication and worker recomputation', async () => {
    const rules = await withAccountContext(db, owner, tx => new ScoringRepository(tx).listEnabledRules());
    const previous = rules.find(r => r.code === 'bike.km.default')!;
    const proposal = validateRuleProposal({ ...previous, replaceRuleId: previous.id,
      validFrom: date, indoorBikeCoefficient: 800 });
    const days = await withAccountContext(db, owner, tx => new RuleChangesRepository(tx).listPreviewDays(date, date));
    const preview = previewRuleChange(days, rules, proposal);
    expect(preview).toMatchObject({ changedDates: 1, aggregateDelta: 500 });
    const queued = await withAccountContext(db, owner, tx => new RuleChangesRepository(tx).enqueueChange({
      proposal, preview, previewFingerprint: 'a'.repeat(64), initiatedBy: owner, reason: 'Synthetic version persistence check' }));
    const dispatchUrl = new URL(url!); dispatchUrl.username = 'sportos_worker'; dispatchUrl.password = '';
    const dataUrl = new URL(url!); dataUrl.username = 'sportos_worker_data'; dataUrl.password = '';
    const dispatcher = createDb(dispatchUrl.toString()), data = createDb(dataUrl.toString());
    try {
      const claim = await new WorkerDispatchRepository(dispatcher).claimRuleChange('indoor-test');
      expect(claim).toMatchObject({ id: queued.id, ownerId: owner });
      expect(await withAccountContext(dispatcher, owner, tx => new ScoringRepository(tx).listEnabledRules())).toEqual([]);
      expect(await withAccountContext(data, foreign, tx => new RuleChangesRepository(tx).getById(queued.id))).toBeNull();
      await withAccountContext(data, owner, tx => new RuleChangesRepository(tx).activateAndRecompute(queued.id, 'indoor-test'));
      const result = await withAccountContext(db, owner, tx => new DailyRepository(tx).getDailyScoreBreakdown(date));
      expect(result).toMatchObject({ score: { baseTotal: 8000, appTotal: 8000 } });
    } finally { await dispatcher.destroy(); await data.destroy(); }
  });
});
