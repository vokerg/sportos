import {loadEnvFile} from 'node:process';
import {existsSync} from 'node:fs';
import {createDb,withAccountContext,PerformanceMatchesRepository,validateMetricBackfillOptions,sql} from '../packages/db/dist/index.js';
if(existsSync('.env'))loadEnvFile('.env');
const values=new Map(),args=process.argv.slice(2).filter(a=>a!=='--');
for(let i=0;i<args.length;i++){
 const key=args[i];if(!['--owner','--limit','--cursor','--event','--accept','--reject','--apply'].includes(key)||values.has(key))throw new Error('Invalid reconciliation options.');
 if(['--apply','--reject'].includes(key))values.set(key,true);else{const v=args[++i];if(!v||v.startsWith('--'))throw new Error('Missing reconciliation option.');values.set(key,v);}
}
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const owner=values.get('--owner');if(!uuid(owner))throw new Error('Explicit --owner UUID required.');
for(const key of ['--event','--accept'])if(values.has(key)&&!uuid(values.get(key)))throw new Error('Invalid review UUID.');
if((values.has('--accept')||values.has('--reject'))&&!values.has('--event'))throw new Error('Review requires --event.');
if(values.has('--accept')&&values.has('--reject'))throw new Error('Choose accept or reject.');
const options={limit:Number(values.get('--limit')??25),cursor:values.get('--cursor'),dryRun:!values.has('--apply')};validateMetricBackfillOptions(options);
const db=createDb();try{
 const r=(await sql`select current_user as role,rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db)).rows[0];
 if(r?.role!=='sportos_app'||r.rolsuper||r.rolbypassrls)throw new Error('Requires non-owner sportos_app.');
 const report=await withAccountContext(db,owner,d=>{
  const repo=new PerformanceMatchesRepository(d);
  return values.has('--event')?repo.reconcile(values.get('--event'),options.dryRun,values.has('--accept')?{activityId:values.get('--accept')}:values.has('--reject')?{activityId:null}:undefined):repo.batch(options);
 });
 // Detailed review includes private metrics and identifiers: terminal/local file only.
 console.log(JSON.stringify(report));
}catch{console.error('Reconciliation failed. Check scoped runtime access/migrations and retry the same cursor.');process.exitCode=1;}finally{await db.destroy();}
