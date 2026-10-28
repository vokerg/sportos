/** Local operator smoke: real PKCE, native/session separation and bounded canonical reads.
 * No source payloads, identifiers, credentials or private results are printed/persisted.
 */
import {loadEnvFile} from 'node:process';
import {existsSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {MobileApiClient} from '../packages/shared/src/mobile-api.js';
if(existsSync('.env'))loadEnvFile('.env');
const base=process.env.SPORTOS_API_ORIGIN??'http://localhost:3010';
const web=process.env.SPORTOS_WEB_ORIGIN??'http://localhost:4210';
for(const value of [base,web]){
 const u=new URL(value);if(u.protocol!=='http:'||!['localhost','127.0.0.1'].includes(u.hostname)||u.origin!==value)throw new Error('Smoke is restricted to exact local HTTP origins.');
}
const devToken=process.env.SPORTOS_DEV_AUTH_TOKEN;
if(!devToken||process.env.NODE_ENV==='production')throw new Error('Local development bootstrap must be explicitly configured.');
async function bootstrap(){
 const r=await fetch(base+'/auth/dev-session',{method:'POST',headers:{Authorization:'Bearer '+devToken},redirect:'error'});
 assert.equal(r.ok,true,'Local browser bootstrap failed');
 const cookies=r.headers.getSetCookie();
 const cookie=cookies.map(s=>s.split(';')[0]).join('; ');
 const csrf=cookies.find(s=>s.startsWith('sportos_csrf='))?.split(';')[0].slice('sportos_csrf='.length);
 assert.ok(cookie&&csrf);return{cookies,cookie,csrf};
}
if(process.argv.includes('--browser')){
 // One-use loopback helper for Safari's real browser confirmation. Secret stays server-side.
 // This is operator tooling, not shipped mobile authentication or a production endpoint.
 const server=createServer(async(req,res)=>{
  const incoming=new URL(req.url??'/', 'http://localhost');
  const request=incoming.searchParams.get('request');
  if(incoming.pathname!=='/bootstrap'||req.method!=='GET'||(request!==null&&!/^[A-Za-z0-9_-]{43}$/.test(request))){res.writeHead(404).end();return;}
  try{const b=await bootstrap();res.writeHead(302,{'Set-Cookie':b.cookies,Location:request?web+'/mobile-connect?request='+encodeURIComponent(request):web+'/', 'Cache-Control':'no-store'}).end();}
  catch{res.writeHead(503).end('Local bootstrap unavailable.');}
  finally{server.close();}
 });
 const port=Number(process.env.SPORTOS_MOBILE_QA_PORT??4311);
 server.on('error',()=>{console.error('Local bootstrap port unavailable. Set SPORTOS_MOBILE_QA_PORT to a free loopback port.');process.exitCode=1;});
 server.listen(port,'127.0.0.1',()=>console.log(`One-use local Safari bootstrap ready at http://localhost:${port}/bootstrap (closes after use).`));
 setTimeout(()=>server.close(),120000).unref();
}else{
 const browser=await bootstrap();let saved:string|null=null;
 const client=new MobileApiClient(base,{read:async()=>saved,write:async token=>{saved=token;},remove:async()=>{saved=null;}},fetch,true);
 try{
  const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url');
  const start=await client.startSignIn(createHash('sha256').update(verifier).digest('base64url'),state);
  assert.equal(new URL(start.authorizationUrl).origin,web);
  const approval=await fetch(base+'/auth/mobile/approve',{method:'POST',headers:{Cookie:browser.cookie,'X-SportOS-CSRF':browser.csrf,'Content-Type':'application/json',Origin:web},body:JSON.stringify({requestId:start.requestId})});
  assert.equal(approval.ok,true,'Cookie+CSRF approval failed');
  const {redirectUrl}=await approval.json() as {redirectUrl:string};
  await client.finishSignIn(redirectUrl,state,verifier);
  assert.ok(await client.restore());
  await assert.rejects(client.finishSignIn(redirectUrl,state,verifier));
  // Correctly use local date-only strings; parity output is only aggregate assertions.
  const now=new Date(),to=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  const endpoints=['/daily/summary?limit=2&to='+to,'/activities?limit=2&offset=0','/performance/leaderboard?distanceM=5000&limit=2&offset=0',`/dynamics/monthly?from=${to}&to=${to}&metrics=score,steps,run,bike,swim,workout,bonus`,`/dynamics/rolling?from=${to}&to=${to}&metric=score&windows=30`,'/heatmap/routes?limit=1'];
  for(const path of endpoints){await client.get(path);}
  // Exercise the same safe projections as native screens against real retained data.
  const daily = await import('../apps/mobile/src/daily/model.mjs');
  const activities = await import('../apps/mobile/src/activities/model.mjs');
  const days = daily.parseDailySummaries(await client.get('/daily/summary?limit=2&to='+to));
  if(days[0]) daily.projectDetail(await client.get(daily.scoreBreakdownPath(days[0].metric_date)));
  for(const sport of ['run','swim','bike','workout','walk']){
    const list = activities.projectActivityList(await client.get(activities.activityListPath({range:'all',type:sport,limit:1})));
    if(!list.items[0]) continue;
    const detail = activities.projectActivityDetail(await client.get(activities.activityDetailPath(list.items[0].id)));
    activities.projectEnrichment(await client.get(activities.activityDetailPath(detail.id)+'/enrichment'));
    if(sport==='swim')activities.projectSwimLengths(await client.get(activities.activityDetailPath(detail.id)+'/swim-lengths'));
  }
  for(const [feature,file] of [['performance','model.mjs'],['analytics','model.mjs'],['maps','model.mjs']]){
    const path=`apps/mobile/src/${feature}/${file}`;if(!existsSync(path))continue;
    const model=await import(new URL('../'+path,import.meta.url).href);
    if(feature==='performance')model.projectLeaderboard(await client.get('/performance/leaderboard?distanceM=5000&limit=20&offset=0'));
    if(feature==='analytics'){
      model.projectMonthly(await client.get(`/dynamics/monthly?from=${to}&to=${to}&metrics=score,steps,run,bike,swim,workout,bonus`));
      model.projectRolling(await client.get(`/dynamics/rolling?from=${to}&to=${to}&metric=score&windows=30`),'score',30);
    }
    if(feature==='maps'){
      const page=model.projectHeatmap(await client.get('/heatmap/routes?limit=1'));
      const runs=activities.projectActivityList(await client.get(activities.activityListPath({range:'all',type:'run',limit:1})));
      if(runs.items[0])model.projectRoute(await client.get(model.routePath(runs.items[0].id)));
    }
  }
  const token=saved;
  assert.equal(await client.signOut(),'revoked');
  const denied=await fetch(base+'/daily/summary?limit=1',{headers:{Authorization:'Bearer '+token}});
  assert.equal(denied.status,401,'Revoked native session must fail even in dev-single-user mode');
  console.log('PASS: real PKCE + one-use exchange; 6 bounded canonical endpoints + native projections; secure sign-out; revoked bearer denied. No private payloads retained.');
 }finally{
  if(saved)await client.signOut();
  await fetch(base+'/auth/logout',{method:'POST',headers:{Cookie:browser.cookie,'X-SportOS-CSRF':browser.csrf}});
 }
}
