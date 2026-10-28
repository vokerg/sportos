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
  if(req.url!=='/bootstrap'||req.method!=='GET'){res.writeHead(404).end();return;}
  try{const b=await bootstrap();res.writeHead(302,{'Set-Cookie':b.cookies,Location:web+'/', 'Cache-Control':'no-store'}).end();}
  catch{res.writeHead(503).end('Local bootstrap unavailable.');}
  finally{server.close();}
 });
 server.listen(4310,'127.0.0.1',()=>console.log('One-use local Safari bootstrap ready at http://localhost:4310/bootstrap (closes after use).'));
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
  const token=saved;
  assert.equal(await client.signOut(),'revoked');
  const denied=await fetch(base+'/daily/summary?limit=1',{headers:{Authorization:'Bearer '+token}});
  assert.equal(denied.status,401,'Revoked native session must fail even in dev-single-user mode');
  console.log('PASS: real PKCE + one-use exchange; 6 bounded canonical endpoints; secure sign-out; revoked bearer denied. No private payloads retained.');
 }finally{
  if(saved)await client.signOut();
  await fetch(base+'/auth/logout',{method:'POST',headers:{Cookie:browser.cookie,'X-SportOS-CSRF':browser.csrf}});
 }
}
