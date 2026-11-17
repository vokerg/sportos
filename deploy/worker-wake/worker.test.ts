import {afterEach,expect,it,vi} from 'vitest';
import {proxy} from './worker.js';
import {parseWakeKeys,signWake,WAKE_HEADER} from '../../packages/worker-wake/src/index.js';
const env={PUBLIC_ORIGIN:'https://gateway.example.test',UPSTREAM_WAKE_URL:'https://origin.example.test/sportos-worker/wake',WAKE_KEYS:`one=${btoa('a'.repeat(32))}`};
afterEach(()=>vi.restoreAllMocks());
const request=async(path='/wake',init:RequestInit={})=>new Request(env.PUBLIC_ORIGIN+path,{method:'POST',body:'{}',headers:{[WAKE_HEADER]:await signWake(await parseWakeKeys(env.WAKE_KEYS),'one')},...init});

it('forwards only the pinned IPv6-capable HTTPS hostname/path and minimal signed request',async()=>{
  const upstream=vi.fn(async(url:URL|RequestInfo,init?:RequestInit)=>{
    expect(String(url)).toBe(env.UPSTREAM_WAKE_URL);expect(init?.redirect).toBe('manual');expect(init?.body).toBe('{}');
    expect([...new Headers(init?.headers).keys()].sort()).toEqual(['content-type',WAKE_HEADER]);
    return new Response(null,{status:202});
  });
  const input=await request();input.headers.set('authorization','Bearer must-not-forward');input.headers.set('cookie','session=must-not-forward');input.headers.set('x-forwarded-host','attacker.test');
  const result=await proxy(input,env,upstream as typeof fetch);expect(result.status).toBe(202);expect(result.headers.get('cache-control')).toBe('no-store');
});

it('rejects wrong authority, path, method, query, forged signatures and streamed oversize without origin calls',async()=>{
  const upstream=vi.fn();
  for(const input of [await request('/wake?url=https://attacker.test'),await request('//attacker.test/path'),await request('/other'),await request('/wake',{method:'GET',body:undefined}),await request('/wake',{headers:{[WAKE_HEADER]:'forged'}}),await request('/wake',{body:'x'.repeat(10000)}),new Request('https://preview.example.test/wake',{method:'POST',body:'{}'})]) {
    expect((await proxy(input,env,upstream)).status).toBeGreaterThanOrEqual(400);
  }
  expect(upstream).not.toHaveBeenCalled();
});

it('fails closed on unsafe origin config, redirects, failures and does not expose response details',async()=>{
  const upstream=vi.fn();
  for(const url of ['https://[2001:db8::1]/sportos-worker/wake','https://127.0.0.1/sportos-worker/wake','http://origin.example.test/sportos-worker/wake','https://user:secret@origin.example.test/sportos-worker/wake',env.PUBLIC_ORIGIN+'/sportos-worker/wake','https://origin.example.test/sportos-worker/wake?x=1','https://placeholder.invalid/sportos-worker/wake']) expect((await proxy(await request(),{...env,UPSTREAM_WAKE_URL:url},upstream)).status).toBe(503);
  expect(upstream).not.toHaveBeenCalled();
  expect((await proxy(await request(),env,async()=>new Response('private payload',{status:302,headers:{location:'https://attacker.test'}}))).status).toBe(502);
  const result=await proxy(await request(),env,async()=>{throw new Error('private upstream');});expect(await result.text()).toBe('');expect(result.status).toBe(502);
});
