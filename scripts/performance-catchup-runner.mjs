/** One bounded serial operator batch. Checkpoint only completed activity work;
 * a failed request stays before the cursor for replay. Provider caching makes
 * a crash between retention and checkpoint safe to retry.
 */
export async function applyPerformanceCatchup(rows,{cursor=null,execute,checkpoint,onProgress=()=>{}}){
 if(rows.length>100)throw new Error('Catch-up batch exceeds limit.');
 const report={reprocessed:0,fetched:0,failed:0,reasons:{},nextCursor:cursor};
 for(const row of rows){
  if(!['skip','fetch','reprocess'].includes(row.action))throw new Error('Unknown catch-up action.');
  if(row.action!=='skip'){
   const request=async()=>{try{return await execute(row.activityId,row.action);}catch{return {failed:true,reason:'request_failed',retryAt:null};}};
   let result=await request();
   if(result.failed&&result.reason==='request_failed')result=await request();
   if(result.failed){
    report.failed++;report.reasons[result.reason]=(report.reasons[result.reason]??0)+1;
    await checkpoint({cursor:report.nextCursor,retryAt:result.retryAt??null});return report;
   }
   report[row.action==='fetch'?'fetched':'reprocessed']++;
  }
  report.nextCursor=row.activityId;
  await checkpoint({cursor:row.activityId});
  onProgress({progress:row.action,activityId:row.activityId});
 }
 return report;
}
