import {useCallback,useRef,useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {connections,connectionPath,job,jobPath,activeJob,type Connection,type SyncJob} from '../providers/model';
import {pollDelay,useOperation,type OperationScope} from '../providers/use-operation';
import {isCalendarDate} from '../ui/format.mjs';
import {projectDetail} from './model.mjs';
import type {MobileDayDetail} from './contracts';

export const factFields = [
 ['steps','Steps (excluding runs)',1],
 ['runOutdoorM','Run outdoor (km)',1000],['runIndoorM','Run treadmill (km)',1000],['runUnspecifiedM','Run unspecified (km)',1000],
 ['bikeOutdoorM','Bike outdoor (km)',1000],['bikeIndoorM','Bike indoor (km)',1000],['bikeUnspecifiedM','Bike unspecified (km)',1000],
 ['swimM','Swim (m)',1],['workoutPoints','Workout points',1],['bonusPoints','Bonus points',1],
] as const;
export type FactField = typeof factFields[number][0];
export type ManualFacts = Record<FactField,number> & {totalSteps?:number};
export type Draft = Record<FactField,string>;
export function factsDraft(value:unknown):{draft:Draft;totalSteps:boolean}{
 if(!value||typeof value!=='object')throw new Error('Invalid facts');
 const raw=value as Record<string,unknown>;
 const draft={} as Draft;
 for(const [key,,scale] of factFields){
  const n=raw[key]??(key==='runUnspecifiedM'||key==='bikeUnspecifiedM'?0:undefined);
  if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>10_000_000)throw new Error('Invalid facts');
  draft[key]=String(n/scale);
 }
 if(raw.totalSteps!==undefined){if(typeof raw.totalSteps!=='number'||!Number.isInteger(raw.totalSteps)||raw.totalSteps<0||raw.totalSteps>10_000_000)throw new Error('Invalid steps');draft.steps=String(raw.totalSteps)}
 return {draft,totalSteps:raw.totalSteps!==undefined};
}
export function parseDraft(draft:Draft,totalSteps:boolean):ManualFacts{
 const result={} as ManualFacts;
 for(const [key,,scale] of factFields){
  const text=draft[key].trim();if(!/^\d+(?:[.,]\d+)?$/.test(text))throw new Error('Enter a non-negative number in every field.');
  const n=Number(text.replace(',','.'))*scale;
  if(!Number.isFinite(n)||n>10_000_000||(['steps','workoutPoints','bonusPoints'].includes(key)&&!Number.isInteger(n)))throw new Error('Values must be at most 10,000,000; steps and points must be whole numbers.');
  result[key]=n;
 }
 if(totalSteps)result.totalSteps=result.steps;
 return result;
}
export function stravaDayWindow(date:string){
 if(!isCalendarDate(date))throw new Error('Invalid date');
 const utc=Date.parse(date+'T00:00:00.000Z');
 return {after:new Date(utc-15*3600000).toISOString(),before:new Date(utc+36*3600000).toISOString()};
}

export function useDayActions(date:string,onUpdated:(detail:MobileDayDetail)=>void){
 const {run,busy,error}=useOperation();
 const [connection,setConnection]=useState<Connection|null>(null);
 const [connectionLoaded,setConnectionLoaded]=useState(false);
 const [pending,setPending]=useState<SyncJob|null>(null);
 const pendingRef=useRef<SyncJob|null>(null);
 const [message,setMessage]=useState('');
 const [validation,setValidation]=useState('');
 const [editor,setEditor]=useState<{draft:Draft;totalSteps:boolean}|null>(null);
 const remember=(value:SyncJob|null)=>{pendingRef.current=value;setPending(value)};
 const loadConnection=useCallback(()=>{void run(async api=>connections(await api.read('/providers/connections')),rows=>{setConnection(rows.find(c=>c.status==='connected')??rows[0]??null);setConnectionLoaded(true)},'Could not check Strava. Try checking the connection again.')},[run]);
 useFocusEffect(useCallback(()=>{loadConnection()},[loadConnection]));
 const accept=(raw:unknown)=>{const detail=projectDetail(raw);if(detail.date!==date)throw new Error('Wrong day');onUpdated(detail)};
 const recalculate=()=>{void run(api=>api.mutate('/daily/'+date+'/recalculate'),raw=>{accept(raw);setMessage('Daily totals and score recalculated.')},'Could not recalculate this day. Check that activities are available and try again.')};
 const monitor=async(api:OperationScope,initial:SyncJob)=>{
  let next=initial;
  for(let checks=0;;checks++){
   if(api.signal.aborted)throw new Error('Cancelled');
   remember(next);
   if(next.status==='succeeded'){
    setMessage('Strava refreshed. Recalculating this day…');
    const raw=await api.mutate('/daily/'+date+'/recalculate');
    return {raw,message:'Strava refetched and daily totals and score recalculated.'};
   }
   if(!activeJob(next))return {raw:null,message:'Strava refresh '+next.status+'. Daily score is unchanged.'};
   if(checks===24)return {raw:null,message:'Automatic checks paused. The server job continues; check refresh status to continue.'};
   setMessage(next.rateLimited?'Waiting for Strava’s rate limit.':'Strava refresh '+next.status+' · '+next.progress+'%');
   await pollDelay(api.signal);
   const response=job(await api.read(jobPath(next.id)),next.connectionId);
   if(response.id!==next.id)throw new Error('Wrong job');
   next=response;
  }
 };
 const refreshStrava=()=>{
  if(connection?.status!=='connected')return;
  setMessage('Checking Strava refresh…');
  void run(async api=>{
   const current=pendingRef.current;
   const next=current?job(await api.read(jobPath(current.id)),connection.id)
    :job(await api.mutate(connectionPath(connection.id)+'/sync',{mode:'webhook_refresh',...stravaDayWindow(date)}),connection.id);
   if(current&&next.id!==current.id)throw new Error('Wrong job');
   return monitor(api,next);
  },result=>{if(result.raw)accept(result.raw);if(result.raw||!activeJob(pendingRef.current)&&pendingRef.current?.status!=='succeeded')remember(null);setMessage(result.message)},'Strava refresh could not finish. Check refresh status before retrying; the score may still need recalculation.');
 };
 const openEditor=()=>{void run(async api=>{
  const rows=await api.read<unknown>('/daily/manual-facts?from='+date+'&to='+date+'&limit=1');
  if(!Array.isArray(rows)||rows.length>1)throw new Error('Invalid facts');
  if(rows.length&&rows[0].date!==date)throw new Error('Wrong day');
  return factsDraft(rows[0]?.facts??Object.fromEntries(factFields.map(([key])=>[key,0])));
 },setEditor,'Could not load current facts. Try again before editing.')};
 const save=()=>{
  if(!editor)return;
  let input:ManualFacts;
  try{input=parseDraft(editor.draft,editor.totalSteps);setValidation('')}catch(e){setValidation(e instanceof Error?e.message:'Invalid facts');return}
  void run(api=>api.mutate('/daily/'+date+'/facts',input,'PUT'),raw=>{accept(raw);setEditor(null);setMessage('Manual facts saved and score recalculated.')},'Could not save manual facts. Your entries are kept here; check the day before retrying.');
 };
 return {save,validation,busy,error,message,connection,connectionLoaded,pending,loadConnection,recalculate,refreshStrava,editor,setEditor,openEditor};
}
