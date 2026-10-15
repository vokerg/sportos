import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { previewRuleChange, validateRuleProposal } from '@sportos/domain';
import { RuleChangesRepository } from './rule-changes.repository.js';
import { WorkerDispatchRepository } from './worker-dispatch.repository.js';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import { ScoringRepository } from './scoring.repository.js';
import { DailyScoringRepository } from './daily-scoring.repository.js';
import { ActivitiesRepository } from './activities.repository.js';
const url = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration('swim ladder with non-owner account-scoped persistence', () => {
  let db: ReturnType<typeof createDb>, owner: string, foreign: string;
  beforeAll(async () => {
    if (new URL(url!).hostname !== '127.0.0.1' || !new URL(url!).pathname.endsWith('_test')) throw new Error('Disposable loopback test database required.');
    db = createDb(url!);
    const role = await sql<{rolsuper:boolean;rolbypassrls:boolean}>`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db);
    expect(role.rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
    owner = (await db.insertInto('accounts').values({display_name:'Synthetic swim',status:'active',email:null}).returning('id').executeTakeFirstOrThrow()).id;
    foreign = (await db.insertInto('accounts').values({display_name:'Synthetic foreign',status:'active',email:null}).returning('id').executeTakeFirstOrThrow()).id;
    await withAccountContext(db,owner,tx=>sql`select sportos_seed_account_rules(${owner}::uuid)`.execute(tx));
  });
  afterAll(async () => { await db?.destroy(); });
  it('seeds exactly four grouped tiers for new accounts, retaining disabled history', async () => {
    const rules = await withAccountContext(db,owner,tx=>new ScoringRepository(tx).listEnabledRules());
    expect(rules.filter(r=>r.achievementGroup==='swim.pace.1k').map(r=>[r.thresholdValue,r.points,r.pointsMultiplier]).sort((a,b)=>Number(b[0])-Number(a[0])))
      .toEqual([[1200,2000,undefined],[1170,3000,undefined],[1140,4000,undefined],[1110,5000,undefined]]);
    const legacy = await withAccountContext(db,owner,tx=>tx.selectFrom('scoring_rules').select(['enabled','points','metric']).where('code','=','swim.1k.sub20.bonus').where('version','=',1).executeTakeFirstOrThrow());
    expect(legacy).toMatchObject({enabled:false,points:1000,metric:'duration_s'});
    expect(await withAccountContext(db,foreign,tx=>new ScoringRepository(tx).listEnabledRules())).toEqual([]);
    expect(await db.selectFrom('scoring_rules').select('id').execute()).toEqual([]);
  });
  it('recalculates one canonical swim, links its exact rule UUID and preserves prior snapshots', async () => {
    const date = '2093-05-18';
    const activity = await withAccountContext(db,owner,async tx=> {
      await tx.insertInto('daily_metrics').values({metric_date:date,swim_m:1000,base_points:7500,bonus_points:0,total_points:7500,score_status:'imported',excel_all_points:7500}).execute();
      return tx.insertInto('activities').values({activity_date:date,activity_type:'swim',source:'strava',source_activity_id:randomUUID(),distance_m:1000,duration_s:1202,moving_time_s:1192}).returningAll().executeTakeFirstOrThrow();
    });
    const result = await withAccountContext(db,owner,tx=>new DailyScoringRepository(tx).recalculateFromActivities(date));
    expect(result).toMatchObject({scoreStatus:'calculated',score:{baseTotal:7500,bonusPoints:2000,appTotal:9500}});
    const bonus = result.ledger.filter(l=>l.rule?.achievementGroup==='swim.pace.1k');
    expect(bonus).toHaveLength(1); expect(bonus[0]).toMatchObject({points:2000,activity:{id:activity.id},rule:{code:'swim.1k.sub20.bonus',metric:'moving_pace_s_per_km'},calculation:{metricValue:1192,multiplierValue:1}});
    const beforeSnapshots = await withAccountContext(db,owner,tx=>tx.selectFrom('daily_score_snapshots').selectAll().where('metric_date','=',date).execute());
    await withAccountContext(db,owner,tx=>new DailyScoringRepository(tx).recalculateFromActivities(date));
    const afterSnapshots = await withAccountContext(db,owner,tx=>tx.selectFrom('daily_score_snapshots').selectAll().where('metric_date','=',date).execute());
    expect(afterSnapshots).toHaveLength(beforeSnapshots.length+1);
    for (const prior of beforeSnapshots) expect(afterSnapshots.find(s=>s.id===prior.id)).toEqual(prior);
    expect(await withAccountContext(db,owner,tx=>tx.selectFrom('activities').selectAll().where('id','=',activity.id).executeTakeFirstOrThrow())).toEqual(activity);
    expect(await withAccountContext(db,foreign,tx=>new ActivitiesRepository(tx).get(activity.id))).toBeNull();
    expect(await withAccountContext(db,foreign,tx=>tx.selectFrom('score_ledger').selectAll().where('activity_id','=',activity.id).execute())).toEqual([]);
  });
  it('carries moving time through preview and split-role rule recomputation', async () => {
    const date = '2093-05-18';
    const rules = await withAccountContext(db,owner,tx=>new ScoringRepository(tx).listEnabledRules());
    const previous = rules.find(r=>r.code==='swim.1k.sub20.bonus')!;
    const proposal = validateRuleProposal({...previous,replaceRuleId:previous.id,validFrom:date,points:2100});
    const days = await withAccountContext(db,owner,tx=>new RuleChangesRepository(tx).listPreviewDays(date,date));
    expect(days[0].activities.find(a=>a.activityType==='swim')).toMatchObject({durationS:1202,movingTimeS:1192});
    const preview = previewRuleChange(days,rules,proposal);
    expect(preview).toMatchObject({changedDates:1,aggregateDelta:100,rows:[{proposedBonusPoints:2100,proposedTotalPoints:9600}]});
    const queued = await withAccountContext(db,owner,tx=>new RuleChangesRepository(tx).enqueueChange({proposal,preview,previewFingerprint:'a'.repeat(64),initiatedBy:owner,reason:'Synthetic moving pace check'}));
    const dispatcherUrl = new URL(url!); dispatcherUrl.username='sportos_worker'; dispatcherUrl.password='';
    const dataUrl = new URL(url!); dataUrl.username='sportos_worker_data'; dataUrl.password='';
    const dispatcher = createDb(dispatcherUrl.toString()), data = createDb(dataUrl.toString());
    try {
      const claim = await new WorkerDispatchRepository(dispatcher).claimRuleChange('swim-worker');
      expect(claim).toMatchObject({id:queued.id,ownerId:owner});
      expect(await withAccountContext(dispatcher,owner,tx=>tx.selectFrom('activities').select('id').execute())).toEqual([]);
      expect(await withAccountContext(dispatcher,owner,tx=>tx.selectFrom('scoring_rules').select('id').execute())).toEqual([]);
      expect(await withAccountContext(data,foreign,tx=>new RuleChangesRepository(tx).getById(queued.id))).toBeNull();
      await withAccountContext(data,owner,tx=>new RuleChangesRepository(tx).activateAndRecompute(queued.id,'swim-worker'));
      const result = await withAccountContext(db,owner,tx=>tx.selectFrom('daily_metrics').select(['bonus_points','total_points']).where('metric_date','=',date).executeTakeFirstOrThrow());
      expect(result).toEqual({bonus_points:2100,total_points:9600});
    } finally { await dispatcher.destroy(); await data.destroy(); }
  });

});
