import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
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
      return tx.insertInto('activities').values({activity_date:date,activity_type:'swim',source:'strava',source_activity_id:randomUUID(),distance_m:1000,duration_s:1133,moving_time_s:1100}).returningAll().executeTakeFirstOrThrow();
    });
    const result = await withAccountContext(db,owner,tx=>new DailyScoringRepository(tx).recalculateFromActivities(date));
    expect(result).toMatchObject({scoreStatus:'calculated',score:{baseTotal:7500,bonusPoints:4000,appTotal:11500}});
    const bonus = result.ledger.filter(l=>l.rule?.achievementGroup==='swim.pace.1k');
    expect(bonus).toHaveLength(1); expect(bonus[0]).toMatchObject({points:4000,activity:{id:activity.id},rule:{code:'swim.1k.sub19.bonus'},calculation:{metricValue:1133,multiplierValue:1}});
    const beforeSnapshots = await withAccountContext(db,owner,tx=>tx.selectFrom('daily_score_snapshots').selectAll().where('metric_date','=',date).execute());
    await withAccountContext(db,owner,tx=>new DailyScoringRepository(tx).recalculateFromActivities(date));
    const afterSnapshots = await withAccountContext(db,owner,tx=>tx.selectFrom('daily_score_snapshots').selectAll().where('metric_date','=',date).execute());
    expect(afterSnapshots).toHaveLength(beforeSnapshots.length+1);
    for (const prior of beforeSnapshots) expect(afterSnapshots.find(s=>s.id===prior.id)).toEqual(prior);
    expect(await withAccountContext(db,owner,tx=>tx.selectFrom('activities').selectAll().where('id','=',activity.id).executeTakeFirstOrThrow())).toEqual(activity);
    expect(await withAccountContext(db,foreign,tx=>new ActivitiesRepository(tx).get(activity.id))).toBeNull();
    expect(await withAccountContext(db,foreign,tx=>tx.selectFrom('score_ledger').selectAll().where('activity_id','=',activity.id).execute())).toEqual([]);
  });
});
