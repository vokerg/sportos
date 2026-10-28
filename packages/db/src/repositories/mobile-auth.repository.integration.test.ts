import {createHash,randomBytes} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {sql} from 'kysely';
import {createDb} from '../pool.js';
import {withAccountContext} from '../ownership-context.js';
import {AuthRepository} from './auth.repository.js';
const url=process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const integration=url?describe:describe.skip;
const hash=()=>createHash('sha256').update(randomBytes(32)).digest('hex');
integration('native PKCE control plane with non-owner PostgreSQL roles',()=>{
 let db:ReturnType<typeof createDb>;let auth:AuthRepository;const owners:string[]=[];const requests:string[]=[];
 beforeAll(async()=>{
  db=createDb(url!);auth=new AuthRepository(db);
  const role=await sql<{rolsuper:boolean;rolbypassrls:boolean}>`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db);
  expect(role.rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
  for(let i=0;i<2;i++)owners.push((await db.insertInto('accounts').values({display_name:'Synthetic native QA '+i,email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id);
 });
 afterAll(async()=>{
  if(!db)return;
  if(requests.length)await db.deleteFrom('mobile_auth_requests').where('request_hash','in',requests).execute();
  for(const owner of owners)await withAccountContext(db,owner,d=>d.deleteFrom('daily_metrics').execute());
  if(owners.length)await db.deleteFrom('accounts').where('id','in',owners).execute();
  await db.destroy();
 });
 it('binds one atomic approval to its authenticated owner and one verifier-bound exchange',async()=>{
  const requestHash=hash(),codeA=hash(),codeB=hash(),codeChallenge='c'.repeat(43),state='s'.repeat(43);requests.push(requestHash);
  await auth.createMobileAuthRequest({requestHash,codeChallenge,state,expiresAt:new Date(Date.now()+60000)});
  const approval=await Promise.all(owners.map((accountId,i)=>auth.approveMobileAuthRequest({requestHash,accountId,codeHash:i?codeB:codeA})));
  expect(approval.filter(Boolean)).toHaveLength(1);
  const winner=approval[0]?0:1;const codeHash=winner?codeB:codeA;
  expect(await auth.consumeMobileAuthRequest({codeHash,state,codeChallenge:'x'.repeat(43)})).toBeNull();
  expect(await auth.consumeMobileAuthRequest({codeHash,state:'x'.repeat(43),codeChallenge})).toBeNull();
  const exchanges=await Promise.all([auth.consumeMobileAuthRequest({codeHash,state,codeChallenge}),auth.consumeMobileAuthRequest({codeHash,state,codeChallenge})]);
  expect(exchanges.filter(Boolean)).toEqual([owners[winner]]);
  expect(await auth.consumeMobileAuthRequest({codeHash,state,codeChallenge})).toBeNull();
 });
 it('denies expired requests and keeps dispatcher/data/legacy roles out of the handoff table',async()=>{
  const requestHash=hash();requests.push(requestHash);
  await auth.createMobileAuthRequest({requestHash,codeChallenge:'c'.repeat(43),state:'s'.repeat(43),expiresAt:new Date(Date.now()-1000)});
  expect(await auth.approveMobileAuthRequest({requestHash,accountId:owners[0],codeHash:hash()})).toBeNull();
  for(const role of ['sportos_worker','sportos_worker_data','sportos_legacy','sportos_data']){
   const result=await sql<{allowed:boolean}>`select has_table_privilege(${role}, 'mobile_auth_requests', 'SELECT') as allowed`.execute(db);
   expect(result.rows[0].allowed).toBe(false);
  }
 });
 it('resolves session owners server-side, enforces RLS and rejects expiry/revocation',async()=>{
  for(let i=0;i<2;i++)await withAccountContext(db,owners[i],d=>d.insertInto('daily_metrics').values({metric_date:'2098-10-01',source_record_id:null,steps:i+1,run_m:0,bike_m:0,swim_m:0,workout_points:0,base_points:0,bonus_points:0,total_points:0,excel_all_points:null,excel_row_hash:null}).execute());
  const tokenHash=hash();const sessionId=await auth.createSession({accountId:owners[0],tokenHash,csrfHash:hash(),userAgentHash:null,expiresAt:new Date(Date.now()+60000),absoluteExpiresAt:new Date(Date.now()+120000)});
  const session=await auth.findActiveSession(tokenHash);expect(session?.account.id).toBe(owners[0]);
  const rows=await withAccountContext(db,session!.account.id,d=>d.selectFrom('daily_metrics').select('steps').execute());
  expect(rows).toHaveLength(1);expect(Number(rows[0].steps)).toBe(1);
  expect(await db.selectFrom('daily_metrics').select('steps').execute()).toEqual([]);
  await auth.revokeSession(sessionId);expect(await auth.findActiveSession(tokenHash)).toBeNull();
  const expired=hash();await auth.createSession({accountId:owners[1],tokenHash:expired,csrfHash:hash(),userAgentHash:null,expiresAt:new Date(Date.now()-1000),absoluteExpiresAt:new Date(Date.now()+60000)});
  expect(await auth.findActiveSession(expired)).toBeNull();
 });
});
