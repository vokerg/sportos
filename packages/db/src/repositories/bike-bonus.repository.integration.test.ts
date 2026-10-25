import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { previewRuleChange, validateRuleProposal } from '@sportos/domain';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import { ScoringRepository } from './scoring.repository.js';
import { DailyScoringRepository } from './daily-scoring.repository.js';
import { DailyRepository } from './daily.repository.js';
import { ActivitiesRepository } from './activities.repository.js';
import { RuleChangesRepository } from './rule-changes.repository.js';
import { WorkerDispatchRepository } from './worker-dispatch.repository.js';

const url = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('cycling blocks with non-owner account-scoped persistence', () => {
  let db: ReturnType<typeof createDb>, owner: string, foreign: string;
  const date = '2094-05-18';
  beforeAll(async () => {
    if (new URL(url!).hostname !== '127.0.0.1' || !new URL(url!).pathname.endsWith('_test')) {
      throw new Error('Disposable loopback test database required.');
    }
    db = createDb(url!);
    const role = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    owner = (await db.insertInto('accounts').values({ display_name: 'Synthetic bike', status: 'active', email: null }).returning('id').executeTakeFirstOrThrow()).id;
    foreign = (await db.insertInto('accounts').values({ display_name: 'Synthetic foreign', status: 'active', email: null }).returning('id').executeTakeFirstOrThrow()).id;
    await withAccountContext(db, owner, tx => sql`select sportos_seed_account_rules(${owner}::uuid)`.execute(tx));
  });
  afterAll(async () => { await db?.destroy(); });

  it('seeds the block rule and retains disabled flat history', async () => {
    const rules = await withAccountContext(db, owner, tx => new ScoringRepository(tx).listEnabledRules());
    expect(rules.filter(r => r.code === 'bike.10k.easy.bonus')).toMatchObject([
      { points: 1000, thresholdValue: 19.9, thresholdUnit: 'km/h', pointsMultiplier: 'completed_10k_blocks' },
    ]);
    const old = await withAccountContext(db, owner, tx => tx.selectFrom('scoring_rules').select(['enabled', 'points', 'points_multiplier'])
      .where('code', '=', 'bike.10k.easy.bonus').where('version', '=', 3).executeTakeFirstOrThrow());
    expect(old).toEqual({ enabled: false, points: 1000, points_multiplier: null });
    expect(await withAccountContext(db, foreign, tx => new ScoringRepository(tx).listEnabledRules())).toEqual([]);
    expect(await db.selectFrom('scoring_rules').select('id').execute()).toEqual([]);
  });

  it('recalculates a 30 km ride, preserves canonical facts and prior score history, and denies foreign reads', async () => {
    const activity = await withAccountContext(db, owner, async tx => {
      await tx.insertInto('daily_metrics').values({ metric_date: date, bike_m: 30_000, base_points: 18_000,
        bonus_points: 0, total_points: 18_000, score_status: 'imported', excel_all_points: 18_000 }).execute();
      return tx.insertInto('activities').values({ activity_date: date, activity_type: 'bike', subtype: 'outdoor',
        source: 'strava', source_activity_id: randomUUID(), distance_m: 30_000, avg_speed_mps: 24 / 3.6 })
        .returningAll().executeTakeFirstOrThrow();
    });
    const result = await withAccountContext(db, owner, tx => new DailyScoringRepository(tx).recalculateFromActivities(date));
    expect(result).toMatchObject({ scoreStatus: 'calculated', score: { baseTotal: 18_000, bonusPoints: 3000, appTotal: 21_000 } });
    expect(result.ledger.filter(l => l.rule?.code === 'bike.10k.easy.bonus')).toMatchObject([
      { points: 3000, activity: { id: activity.id }, rule: { pointsMultiplier: 'completed_10k_blocks' },
        calculation: { metricValue: Number(activity.avg_speed_mps) * 3.6, multiplierInputValue: 30_000, multiplierValue: 3, awardedPoints: 3000 } },
    ]);
    const before = await withAccountContext(db, owner, tx => tx.selectFrom('daily_score_snapshots').selectAll().where('metric_date', '=', date).execute());
    await withAccountContext(db, owner, tx => new DailyScoringRepository(tx).recalculateFromActivities(date));
    const after = await withAccountContext(db, owner, tx => tx.selectFrom('daily_score_snapshots').selectAll().where('metric_date', '=', date).execute());
    expect(after).toHaveLength(before.length + 1);
    for (const prior of before) expect(after.find(s => s.id === prior.id)).toEqual(prior);
    expect(await withAccountContext(db, owner, tx => tx.selectFrom('activities').selectAll().where('id', '=', activity.id).executeTakeFirstOrThrow())).toEqual(activity);
    expect(await withAccountContext(db, foreign, tx => new ActivitiesRepository(tx).get(activity.id))).toBeNull();
    expect(await withAccountContext(db, foreign, tx => new DailyRepository(tx).getDailyScoreBreakdown(date))).toBeNull();
    expect(await withAccountContext(db, foreign, tx => tx.selectFrom('score_ledger').selectAll().where('activity_id', '=', activity.id).execute())).toEqual([]);
  });

  it('previews and recomputes block awards with split worker roles', async () => {
    const rules = await withAccountContext(db, owner, tx => new ScoringRepository(tx).listEnabledRules());
    const previous = rules.find(r => r.code === 'bike.10k.easy.bonus')!;
    const proposal = validateRuleProposal({ ...previous, replaceRuleId: previous.id, validFrom: date, points: 1100 });
    const days = await withAccountContext(db, owner, tx => new RuleChangesRepository(tx).listPreviewDays(date, date));
    const preview = previewRuleChange(days, rules, proposal);
    expect(preview).toMatchObject({ changedDates: 1, aggregateDelta: 300, rows: [{ proposedBonusPoints: 3300, proposedTotalPoints: 21_300 }] });
    const queued = await withAccountContext(db, owner, tx => new RuleChangesRepository(tx).enqueueChange({ proposal, preview,
      previewFingerprint: 'a'.repeat(64), initiatedBy: owner, reason: 'Synthetic bike block check' }));
    const dispatcherUrl = new URL(url!); dispatcherUrl.username = 'sportos_worker'; dispatcherUrl.password = '';
    const dataUrl = new URL(url!); dataUrl.username = 'sportos_worker_data'; dataUrl.password = '';
    const dispatcher = createDb(dispatcherUrl.toString()), data = createDb(dataUrl.toString());
    try {
      const claim = await new WorkerDispatchRepository(dispatcher).claimRuleChange('bike-worker');
      expect(claim).toMatchObject({ id: queued.id, ownerId: owner });
      for (const table of ['activities', 'scoring_rules', 'score_ledger'] as const) {
        expect(await withAccountContext(dispatcher, owner, tx => tx.selectFrom(table).select('id').execute())).toEqual([]);
      }
      await expect(withAccountContext(dispatcher, owner, tx => tx.selectFrom('daily_score_snapshots').select('id').execute())).rejects.toMatchObject({ code: '42501' });
      expect(await withAccountContext(data, foreign, tx => new RuleChangesRepository(tx).getById(queued.id))).toBeNull();
      await withAccountContext(data, owner, tx => new RuleChangesRepository(tx).activateAndRecompute(queued.id, 'bike-worker'));
      expect(await withAccountContext(db, owner, tx => tx.selectFrom('daily_metrics').select(['bonus_points', 'total_points']).where('metric_date', '=', date).executeTakeFirstOrThrow()))
        .toEqual({ bonus_points: 3300, total_points: 21_300 });
    } finally { await dispatcher.destroy(); await data.destroy(); }
  });
});
