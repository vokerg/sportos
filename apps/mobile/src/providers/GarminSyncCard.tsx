import React,{useCallback,useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {Action,Body,Card} from '../ui/primitives';
import {useOperation} from './use-operation';
import {garminJob,activeGarminJob,garminJobMessage,type GarminFetchJob} from './garmin-jobs';
import {trackGarminJob} from './track-garmin-job';
interface Connection {enabled:boolean;reason:string;cursor:{date:string;at:string;completed:boolean}|null;activeJob:GarminFetchJob|null}
function connection(raw:unknown):Connection {
 if(!raw||typeof raw!=='object')throw new Error('Invalid Garmin connection');const r=raw as Record<string,unknown>;
 if(typeof r.enabled!=='boolean'||typeof r.reason!=='string')throw new Error('Invalid Garmin connection');
 const cursor=r.cursor as Connection['cursor'];
 if(cursor&&(typeof cursor.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(cursor.date)||typeof cursor.at!=='string'||!Number.isFinite(Date.parse(cursor.at))||typeof cursor.completed!=='boolean'))throw new Error('Invalid Garmin cursor');
 // The general control can report an active targeted request without treating
 // it as a general sync or selecting a different target.
 const active=r.activeJob as GarminFetchJob|null;
 const target=active?.operation==='sync'?{operation:'sync' as const}:active?.operation==='day'?{operation:'day' as const,date:active.date!}:active?.operation==='activity'?{operation:'activity' as const,activityId:active.activityId!}:null;
 if(active&&!target)throw new Error('Invalid Garmin job');
 return {enabled:r.enabled,reason:r.reason,cursor,activeJob:active?garminJob(active,target!):null};
}
export function GarminSyncCard(){
 const operation=useOperation(),cancellation=useOperation();const [data,setData]=useState<Connection|null>(null);const [current,setJob]=useState<GarminFetchJob|null>(null);const [message,setMessage]=useState('');
 const load=useCallback(()=>{void operation.run(async api=>connection(await api.read('/garmin/connection')),result=>{setData(result);setJob(result.activeJob)},'Could not check Garmin. Check status before syncing again.')},[operation.run]);
 useFocusEffect(useCallback(()=>{load()},[load]));
 const cancel=()=>{const saved=current;if(!saved||saved.operation!=='sync')return;void cancellation.run(async api=>garminJob(await api.mutate('/garmin/jobs/'+saved.id+'/cancel'),{operation:'sync'}),job=>{setJob(job);setMessage(garminJobMessage(job))},'Could not cancel Garmin. Check status.');};
 const action=(kind:'sync'|'check'|'retry')=>{
  if(!data?.enabled||operation.busy)return;
  const saved=current;
  void operation.run(async api=>{
   let job:GarminFetchJob;
   if(kind==='check'&&saved)job=garminJob(await api.read('/garmin/jobs/'+saved.id),{operation:'sync'});
   else job=garminJob(await api.mutate(kind==='sync'?'/garmin/sync':'/garmin/jobs/'+saved!.id+'/'+kind),{operation:'sync'});
   const result=await trackGarminJob(api,job,{operation:'sync'},next=>{setJob(next);setMessage(garminJobMessage(next))});
   return {job:result,connection:connection(await api.read('/garmin/connection'))};
  },result=>{setJob(result.job);setData(result.connection)},'Garmin request could not be confirmed. Check status before trying again.');
 };
 return <Card title="Garmin">
  {data?.cursor?<Body subdued>Cursor: {data.cursor.date} · {new Date(data.cursor.at).toLocaleString()}</Body>:null}
  {data&&!data.enabled?<Body subdued>{data.reason==='worker_offline'?'Garmin worker is offline.':'Connect or reconnect Garmin on your workstation.'}</Body>:null}
  {current?<Body>Garmin {current.status}{current.operation==='sync'?' · '+(current.processedDays??0)+' / '+(current.totalDays??0)+' days':''}</Body>:null}
  {message?<Body subdued>{message}</Body>:null}
  <Action title={operation.busy?'Syncing Garmin…':'Sync Garmin'} disabled={operation.busy||!!operation.error||!data?.enabled||activeGarminJob(current)} onPress={()=>action('sync')}/>
  {current?.operation==='sync'&&activeGarminJob(current)?<><Action title="Check Garmin job" secondary disabled={operation.busy||!data?.enabled} onPress={()=>action('check')}/><Action title="Cancel Garmin sync" secondary disabled={cancellation.busy} onPress={cancel}/></>:null}
  {current?.operation==='sync'&&['failed','cancelled'].includes(current.status)?<Action title="Retry Garmin sync" disabled={operation.busy||!data?.enabled} onPress={()=>action('retry')}/>:null}
  {operation.error?<Body subdued>{operation.error}</Body>:null}{cancellation.error?<Body subdued>{cancellation.error}</Body>:null}
  <Action title="Check Garmin status" secondary disabled={operation.busy} onPress={load}/>
  <Body subdued>Refresh from the cursor day through today, including late uploads and steps. Repeat any time; scores stay unchanged.</Body>
 </Card>;
}
