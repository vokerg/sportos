import {afterEach, expect, it, vi} from 'vitest';
import {createWakeListener} from './wake-listener.js';
import {parseWakeKeys, signWake, WAKE_HEADER} from '@sportos/worker-wake';
import type {Server} from 'node:http';
import {request as httpRequest} from 'node:http';
const servers:Server[]=[];
afterEach(async()=>{vi.useRealTimers();await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());})));});

it('accepts authenticated fixed hints, coalesces replays and bounds fresh wake rate without SQL',async()=>{
  const keys=await parseWakeKeys(`one=${btoa('a'.repeat(32))}`),wake=vi.fn();
  const server=createWakeListener(keys,wake);servers.push(server);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error();
  const url=`http://127.0.0.1:${address.port}/wake`;
  const signature=await signWake(keys,'one');
  const send=(header=signature,body='{}',path=url,host='localhost')=>new Promise<{status:number}>((resolve,reject)=>{
    const request=httpRequest(path,{method:'POST',headers:{[WAKE_HEADER]:header,host}},response=>{response.resume();response.on('end',()=>resolve({status:response.statusCode!}));});
    request.on('error',reject);request.end(body);
  });
  expect((await send()).status).toBe(202);expect(wake).toHaveBeenCalledOnce();
  expect((await send()).status).toBe(202);expect(wake).toHaveBeenCalledOnce();
  expect((await send(await signWake(keys,'one'))).status).toBe(202);
  expect((await send('forged')).status).toBe(401);
  expect((await send(signature,'{}',url+'?owner=foreign')).status).toBe(404);
  expect((await fetch(url)).status).toBe(404);
  expect((await send(signature,'[]')).status).toBe(400);
  expect((await send(signature,'x'.repeat(10000))).status).toBe(413);
  expect((await send(signature,'{}',url,'attacker.test')).status).toBe(404);
  expect((await send(await signWake(keys,'one',Date.now()-61_000))).status).toBe(401);
  expect(wake).toHaveBeenCalledOnce();
  await vi.waitFor(()=>expect(wake).toHaveBeenCalledTimes(2),{timeout:2500,interval:20});
});
