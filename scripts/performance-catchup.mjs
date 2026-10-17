import {applyPerformanceCatchup} from './performance-catchup-runner.mjs';
import {loadEnvFile} from 'node:process';
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync,unlinkSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {createDb,withAccountContext,previewPerformanceCatchup,sql} from '../packages/db/dist/index.js';
if(existsSync('.env'))loadEnvFile('.env');
const args=process.argv.slice(2).filter(a=>a!=='--'),values=new Map();
for(let i=0;i<args.length;i++){
 const key=args[i];if(!['--owner','--limit','--cursor','--from','--through','--checkpoint','--apply','--api','--retry-unavailable'].includes(key)||values.has(key))throw new Error('Invalid catch-up options.');
 if(['--apply','--retry-unavailable'].includes(key))values.set(key,true);else{const v=args[++i];if(!v||v.startsWith('--'))throw new Error('Missing option.');values.set(key,v);}
}
const owner=values.get('--owner');if(typeof owner!=='string'||!/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(owner))throw new Error('Explicit --owner UUID required.');
const apply=values.has('--apply'),checkpoint=values.get('--checkpoint')?resolve(values.get('--checkpoint')):null;
if(checkpoint&&!relative(process.cwd(),checkpoint).startsWith('..'))throw new Error('Private checkpoint must be outside the repository.');
if(apply&&!checkpoint)throw new Error('Apply requires a private --checkpoint path outside the repository.');
const previous=checkpoint&&existsSync(checkpoint)?JSON.parse(readFileSync(checkpoint,'utf8')):null;
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const options={dryRun:!apply,limit:Number(values.get('--limit')??25),cursor:values.get('--cursor')??previous?.cursor??undefined,through:values.get('--through')??previous?.through??today(),from:values.get('--from')??previous?.from};
if(previous&&(previous.owner!==owner||previous.through!==options.through||previous.from!==options.from))throw new Error('Checkpoint scope mismatch. Use a fresh checkpoint for a new scan.');
if(!process.env.SPORTOS_ACTIVITY_DETAIL_DATABASE_URL)throw new Error('Separate detail database URL required.');
const primary=createDb(),detail=createDb(process.env.SPORTOS_ACTIVITY_DETAIL_DATABASE_URL);
let cookies='',csrf='',locked=false;
const api=new URL(values.get('--api')??process.env.SPORTOS_API_ORIGIN??'http://localhost:3010');
if(!['localhost','127.0.0.1','[::1]'].includes(api.hostname)||api.protocol!=='http:'||api.pathname!=='/'||api.username||api.password)throw new Error('Local operator API must be an HTTP loopback origin.');
async function login(){
 if(!process.env.SPORTOS_DEV_AUTH_TOKEN)throw new Error('Configured local development login is required.');
 const response=await fetch(new URL('/auth/dev-session',api),{method:'POST',headers:{Authorization:`Bearer ${process.env.SPORTOS_DEV_AUTH_TOKEN}`},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error('Local authentication unavailable.');
 const session=await response.json();if(session.account?.id!==owner)throw new Error('Authenticated owner does not match the explicit operator owner.');
 const raw=response.headers.getSetCookie();cookies=raw.map(c=>c.split(';')[0]).join('; ');
 csrf=decodeURIComponent(raw.map(c=>c.split(';')[0]).find(c=>/csrf/i.test(c.split('=')[0]))?.split('=').slice(1).join('=')??'');
 if(!csrf)throw new Error('Session CSRF unavailable.');
}
async function post(activityId,action){
 const path=action==='fetch'?'provider-detail':'efforts/reprocess';
 const response=await fetch(new URL(`/activities/${activityId}/${path}`,api),{method:'POST',headers:{Cookie:cookies,'X-SportOS-CSRF':csrf,'Content-Type':'application/json'},body:JSON.stringify(action==='fetch'&&values.has('--retry-unavailable')?{refresh:true}:{}),signal:AbortSignal.timeout(180000)});
 // Discard private provider response. Only bounded failure categories/projection status are inspected.
 const payload=await response.json().catch(()=>null);
 if(!response.ok)return {failed:true,reason:['PROVIDER_RATE_LIMITED','PROVIDER_REAUTHORIZATION_REQUIRED','ACTIVITY_NOT_FOUND'].includes(payload?.code)?payload.code:'request_failed',retryAt:typeof payload?.retryAt==='string'?payload.retryAt:null};
 const results=payload?.effortProjection;
 if(Array.isArray(results)&&results.some(r=>r.provider==='strava'&&['errors','stale'].includes(r.category)))return {failed:true,reason:'projection_retry_required',retryAt:null};
 return {failed:false};
}
try{
 for(const db of [primary,detail]){const r=(await sql`select current_user as role,rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db)).rows[0];if(r?.role!=='sportos_app'||r.rolsuper||r.rolbypassrls)throw new Error('Non-owner sportos_app URLs required.');}
 const plan=await withAccountContext(primary,owner,d=>previewPerformanceCatchup(d,fn=>withAccountContext(detail,owner,fn),options));
 if(values.has('--retry-unavailable'))for(const row of plan.rows)if(row.category==='unavailable')row.action='fetch';
 const categories={};for(const row of plan.rows)categories[row.category]=(categories[row.category]??0)+1;
 if(previous?.cutoffs&&JSON.stringify(previous.cutoffs)!==JSON.stringify(plan.cutoffs))throw new Error('Historical cutoffs changed; restart with a new checkpoint.');
 if(plan.blocked){console.log(JSON.stringify({blocked:plan.blocked,processed:0,fetched:0}));process.exitCode=1;}
 else{
  const report={dryRun:!apply,unanchoredTargets:plan.unanchoredTargets,eligible:plan.rows.length,categories,reprocessed:0,fetched:0,failed:0,reasons:{},nextCursor:options.cursor??null,hasMore:plan.hasMore};
  if(apply){
   if(previous?.retryAt&&Date.parse(previous.retryAt)>Date.now())throw new Error('Rate-limit checkpoint is not due yet.');
   mkdirSync(dirname(checkpoint),{recursive:true,mode:0o700});
   writeFileSync(`${checkpoint}.lock`,String(process.pid),{mode:0o600,flag:'wx'});locked=true;
   const save=async change=>{
    writeFileSync(`${checkpoint}.tmp`,JSON.stringify({owner,through:options.through,from:options.from,cutoffs:plan.cutoffs,...change}),{mode:0o600});
    renameSync(`${checkpoint}.tmp`,checkpoint);
   };
   if(!previous)await save({cursor:options.cursor??null});
   if(plan.rows.some(r=>r.action!=='skip'))await login();
   Object.assign(report,await applyPerformanceCatchup(plan.rows,{cursor:options.cursor??null,execute:post,checkpoint:save,onProgress:progress=>console.log(JSON.stringify(progress))}));
  }else report.nextCursor=plan.nextCursor;
  console.log(JSON.stringify(report));if(report.failed)process.exitCode=1;
 }
}catch{console.error('Catch-up stopped safely. Check local API authentication, runtime access and checkpoint scope; retry the same checkpoint.');process.exitCode=1;}finally{if(locked)unlinkSync(`${checkpoint}.lock`);await primary.destroy();await detail.destroy();}
