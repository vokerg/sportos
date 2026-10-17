import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyPerformanceCatchup} from './performance-catchup-runner.mjs';
const row=(id,action='fetch')=>({activityId:id,action});
test('retained/current work never requests new detail, targets share one activity request',async()=>{
 const calls=[],checkpoints=[];
 const report=await applyPerformanceCatchup([row('current','skip'),{...row('retained','reprocess'),targets:[5000,10000]},row('missing')],{execute:async(id,action)=>{calls.push([id,action]);return {failed:false};},checkpoint:async c=>checkpoints.push(c)});
 assert.deepEqual(calls,[['retained','reprocess'],['missing','fetch']]);assert.equal(report.fetched,1);assert.equal(report.reprocessed,1);assert.equal(report.nextCursor,'missing');assert.equal(checkpoints.length,3);
});
test('rate limits checkpoint the last completion and stop without consuming subsequent work',async()=>{
 const calls=[],checkpoints=[];
 const report=await applyPerformanceCatchup([row('ok'),row('limited'),row('later')],{execute:async id=>{calls.push(id);return id==='limited'?{failed:true,reason:'PROVIDER_RATE_LIMITED',retryAt:'2095-01-01T00:00:00Z'}:{failed:false};},checkpoint:async c=>checkpoints.push(c)});
 assert.deepEqual(calls,['ok','limited']);assert.equal(report.nextCursor,'ok');assert.equal(report.failed,1);assert.equal(checkpoints.at(-1).retryAt,'2095-01-01T00:00:00Z');
});
test('transient network errors retry once and leave failed work retriable',async()=>{
 let calls=0;const checkpoints=[];
 const report=await applyPerformanceCatchup([row('failed'),row('later')],{cursor:'before',execute:async()=>{calls++;throw new Error('offline');},checkpoint:async c=>checkpoints.push(c)});
 assert.equal(calls,2);assert.equal(report.nextCursor,'before');assert.equal(report.failed,1);assert.equal(checkpoints.at(-1).cursor,'before');
});
test('process interruption after successful work can replay from the prior cursor safely',async()=>{
 const saved=[],calls=[];
 await assert.rejects(applyPerformanceCatchup([row('first'),row('second')],{execute:async id=>{calls.push(id);return {failed:false};},checkpoint:async c=>{if(c.cursor==='second')throw new Error('disk unavailable');saved.push(c);}}));
 assert.equal(saved.at(-1).cursor,'first');
 const replay=await applyPerformanceCatchup([row('second','reprocess')],{cursor:saved.at(-1).cursor,execute:async(id,action)=>{assert.equal(action,'reprocess');return {failed:false};},checkpoint:async c=>saved.push(c)});
 assert.equal(replay.fetched,0);assert.equal(replay.nextCursor,'second');
});
test('bounded and allowlisted work fails before arbitrary actions',async()=>{
 await assert.rejects(applyPerformanceCatchup(Array(101).fill(row('x')),{execute:async()=>assert.fail(),checkpoint:async()=>{}}));
 await assert.rejects(applyPerformanceCatchup([row('x','arbitrary')],{execute:async()=>assert.fail(),checkpoint:async()=>{}}));
});
