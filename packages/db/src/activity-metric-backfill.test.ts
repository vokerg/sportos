import { expect,it } from 'vitest';
import { validateMetricBackfillOptions } from './activity-metric-backfill.js';
it('validates bounded retained-only cursor batches and retries before querying',()=>{
  expect(()=>validateMetricBackfillOptions({limit:100,dryRun:true,retries:2,cursor:'11111111-1111-4111-8111-111111111111'})).not.toThrow();
  for (const input of [{limit:0,dryRun:true},{limit:101,dryRun:false},{limit:1,dryRun:true,cursor:'not-an-id'},{limit:1,dryRun:true,retries:3},{limit:1,dryRun:'true'}]) expect(()=>validateMetricBackfillOptions(input as never)).toThrow('Invalid bounded');
});
