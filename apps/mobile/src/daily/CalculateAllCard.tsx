import React,{useCallback,useRef,useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {Action,Body,Card} from '../ui/primitives';
import {pollDelay,useOperation,type OperationScope} from '../providers/use-operation';
import {calculationActive,calculationJob,calculationState,type CalculationJob,type CalculationState} from './calculation-model';
const path='/daily/recalculation';
async function track(api:OperationScope,initial:CalculationJob,progress:(job:CalculationJob)=>void){
 let job=initial;
 for(let i=0;;i++){
  if(api.signal.aborted)throw new Error('Cancelled');progress(job);
  if(!calculationActive(job)||i===24)return job;
  await pollDelay(api.signal);const next=calculationJob(await api.read(path+'/jobs/'+job.id));if(next.id!==job.id)throw new Error('Unexpected calculation job');job=next;
 }
}
export function CalculateAllCard({onCalculated}:{onCalculated?:()=>void}){
 const operation=useOperation(),cancellation=useOperation();const [state,setState]=useState<CalculationState|null>(null);const [current,setJob]=useState<CalculationJob|null>(null);
 const callback=useRef(onCalculated);callback.current=onCalculated;
 const accept=(result:{state:CalculationState;job:CalculationJob|null})=>{setState(result.state);setJob(result.state.activeJob??result.job);if(result.job&&!calculationActive(result.job))callback.current?.()};
 const load=useCallback(()=>{void operation.run(async api=>{
  let state=calculationState(await api.read(path));let job=state.activeJob??state.latestJob;
  if(state.activeJob){job=await track(api,state.activeJob,setJob);state=calculationState(await api.read(path));}
  return {state,job};
 },accept,'Could not check calculation status. Check status before starting another run.')},[operation.run]);
 useFocusEffect(useCallback(()=>{load()},[load]));
 const action=(kind:'start'|'retry'|'check')=>{
  if(operation.busy||operation.error||!state)return;const saved=current;
  if(kind==='start'&&calculationActive(saved))return;
  void operation.run(async api=>{
   const first=calculationJob(kind==='check'?await api.read(path+'/jobs/'+saved!.id):await api.mutate(kind==='start'?path:path+'/jobs/'+saved!.id+'/retry'));
   const job=await track(api,first,setJob);return {job,state:calculationState(await api.read(path))};
  },accept,'Could not confirm the calculation request. Check status before trying again.');
 };
 const cancel=()=>{if(!current)return;const id=current.id;void cancellation.run(async api=>calculationJob(await api.mutate(path+'/jobs/'+id+'/cancel')),setJob,'Could not confirm cancellation. Check calculation status.')};
 return <Card title="Daily calculation">
  {state?<><Body subdued>Completed through: {state.cursor.completedThrough??'not yet started'} · Next: {state.nextDate}</Body><Body subdued>Calendar: {state.cursor.timeZone}</Body></>:null}
  <Action title={operation.busy?'Calculating…':'Calculate all'} disabled={operation.busy||!!operation.error||!state||calculationActive(current)} onPress={()=>action('start')}/>
  {current?<><Body>Calculation {current.status} · {current.processedDays} / {current.totalDays} days</Body>
   {current.status==='failed'?<Body subdued>{current.errorCode==='DAILY_DATA_UNAVAILABLE'?'Retain source evidence for '+current.nextDate+', then retry. This day has not been skipped.':'Calculation failed. Earlier completed days are saved.'}</Body>:null}
   {calculationActive(current)?<><Action title="Check calculation job" secondary disabled={operation.busy||!!operation.error} onPress={()=>action('check')}/><Action title="Cancel calculation" secondary disabled={cancellation.busy} onPress={cancel}/></>:null}
   {['failed','cancelled'].includes(current.status)?<Action title="Retry calculation" disabled={operation.busy||!!operation.error} onPress={()=>action('retry')}/>:null}
  </>:null}
  {operation.error?<Body subdued>{operation.error}</Body>:null}{cancellation.error?<Body subdued>{cancellation.error}</Body>:null}
  <Action title="Check calculation status" secondary disabled={operation.busy} onPress={load}/>
  <Body subdued>Calculate retained data through today. Today stays provisional and is recalculated on every run.</Body>
 </Card>;
}
