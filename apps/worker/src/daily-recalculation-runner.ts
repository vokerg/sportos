import {DailyRecalculationDispatchRepository,DailyRecalculationError,DailyRecalculationRepository,DailyRecalculationUnavailableError,withAccountContext,type Database,type Kysely} from '@sportos/db';
import {runPollingLoop} from './polling-loop.js';

export class DailyRecalculationRunner {
 constructor(private readonly dispatch:Kysely<Database>,private readonly data:Kysely<Database>,private readonly workerId:string){}
 async processNext(signal?:AbortSignal){
  if(signal?.aborted)return false;
  const claim=await new DailyRecalculationDispatchRepository(this.dispatch).claim(this.workerId);
  if(!claim)return false;
  await withAccountContext(this.data,claim.owner_id,async db=>{
   const repository=new DailyRecalculationRepository(db);
   try{await repository.process(claim.id,this.workerId,signal)}catch(error){
    if(error instanceof DailyRecalculationError&&error.code==='LEASE_LOST')return;
    await repository.fail(claim.id,this.workerId,error instanceof DailyRecalculationUnavailableError?'DAILY_DATA_UNAVAILABLE':'DAILY_RECALCULATION_FAILED').catch(()=>undefined);
   }
  });
  return true;
 }
 async run(signal:AbortSignal){await runPollingLoop(()=>this.processNext(signal),1000,signal)}
}
