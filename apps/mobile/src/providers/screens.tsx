import React,{useCallback,useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {useSession} from '../auth/SessionProvider';
import {Action,Body,Card,Screen,SourceBadge,StatusPanel} from '../ui/primitives';
import {activeJob,connections,connectionPath,job,jobPath,jobs,type Connection,type SyncJob} from './model';
import {pollDelay,useOperation} from './use-operation';

export function StravaConnectionCard({connection,compact=false}:{connection:Connection;compact?:boolean}){
 const {read}=useSession();const {run,busy,error}=useOperation();
 const [current,setJob]=useState<SyncJob|null>(null);const [loaded,setLoaded]=useState(false);const [pollMessage,setPollMessage]=useState('');const [revision,setRevision]=useState(0);
 const load=useCallback(()=>{void run(async api=>jobs(await api.read(connectionPath(connection.id)+'/jobs?limit=5'),connection.id),rows=>{setJob(rows.find(activeJob)??rows[0]??null);setLoaded(true);setRevision(v=>v+1)},'Could not read sync jobs. Refresh status before starting another sync.')},[run,connection.id]);
 useFocusEffect(useCallback(()=>{setLoaded(false);setJob(null);load()},[load]));
 const jobId=current?.id;const active=activeJob(current);
 useFocusEffect(useCallback(()=>{
  if(!active||!jobId)return;
  const controller=new AbortController();let live=true;setPollMessage('');
  void(async()=>{try{for(let i=0;i<24;i++){
   await pollDelay(controller.signal);
   const next=job(await read(jobPath(jobId),controller.signal),connection.id);
   if(!live)return;setJob(next);if(!activeJob(next))return;
  }if(live)setPollMessage('Automatic checks paused after two minutes. The job continues on the server; refresh status to check again.')}
  catch{if(live)setPollMessage('Automatic status checks stopped. Refresh status to reconnect.')}})();
  return()=>{live=false;controller.abort()};
 },[active,jobId,read,connection.id,revision]));
 const action=(path:string,body?:unknown)=>{setLoaded(false);void run(async api=>job(await api.mutate(path,body),connection.id),next=>{setLoaded(true);setJob(next);setRevision(v=>v+1)},'Request failed or timed out. Refresh status to check whether it was accepted before retrying.')};
 const importFromStrava=()=>action(connectionPath(connection.id)+'/sync',{mode:connection.lastSyncAt||current?.status==='succeeded'?'incremental':'initial_backfill'});
 const retryImport=()=>current&&action(jobPath(current.id)+'/retry');
 return <Card title="Strava">
  <SourceBadge label={connection.status.replaceAll('_',' ')}/>
  {!compact?<Body subdued>Last completed sync: {connection.lastSyncAt?new Date(connection.lastSyncAt).toLocaleString():'Not reported'}</Body>:null}
  {connection.status!=='connected'?<Body subdued>Connect or reauthorize Strava in the SportOS website, then refresh connections here.</Body>:null}
  {current?<>
   <Body>{compact?'Strava import':'Latest sync'}: {current.status} · {current.progress}%</Body>
   {current.rateLimited&&active?<Body subdued>Waiting for Strava’s rate limit. The worker will resume when allowed.</Body>:null}
   {current.cancelling?<Body subdued>Cancellation requested; waiting for sync to stop.</Body>:null}
   {current.status==='succeeded'?<Body subdued>Sync completed. Return to Home, Daily or Activities to load the updated server data.</Body>:null}
   {current.status==='failed'?<Body subdued>Sync failed. Your previous activities are safe. Try again.</Body>:null}
  </>:null}
  {active?<Action title="Cancel sync" secondary disabled={busy||current?.cancelling} onPress={()=>action(jobPath(current!.id)+'/cancel')}/>:null}
  {current&&['failed','cancelled'].includes(current.status)&&current.canRetry?<Action title="Retry sync" disabled={busy||connection.status!=='connected'} onPress={()=>action(jobPath(current.id)+'/retry')}/>:null}
  {compact?<Action title={busy?'Starting import…':active?'Importing Strava…':current?.status==='failed'&&current.canRetry?'Retry Strava import':'Import Strava'} disabled={busy||!loaded||active||connection.status!=='connected'} onPress={current?.status==='failed'&&current.canRetry?retryImport:importFromStrava}/>
   :<Action title={busy?'Working…':'Sync changes'} disabled={busy||!loaded||active||connection.status!=='connected'} onPress={()=>action(connectionPath(connection.id)+'/sync',{mode:'incremental'})}/>}
  {error?<Body subdued>{error}</Body>:null}{pollMessage?<Body subdued>{pollMessage}</Body>:null}
  <Action title="Refresh sync status" secondary disabled={busy} onPress={load}/>
 </Card>;
}
export function StravaQuickSyncCard(){
 const {read}=useSession();const [connection,setConnection]=useState<Connection|null>(null);const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');const [revision,setRevision]=useState(0);
 useFocusEffect(useCallback(()=>{let live=true;const controller=new AbortController();setStatus('loading');setConnection(null);
  void read<unknown>('/providers/connections',controller.signal).then(value=>{const rows=connections(value);return rows.find(item=>item.status==='connected')??rows[0]??null})
   .then(value=>{if(live){setConnection(value);setStatus('ready')}}).catch(()=>{if(live)setStatus('error')});
  return()=>{live=false;controller.abort()};
 },[read,revision]));
 if(status==='loading')return <Card title="Strava"><StatusPanel kind="loading" message="Checking Strava connection…"/></Card>;
 if(status==='error')return <Card title="Strava"><StatusPanel kind="error" message="Could not check Strava connection." retry={()=>setRevision(value=>value+1)}/></Card>;
 if(connection)return <StravaConnectionCard connection={connection} compact/>;
 return <Card title="Strava"><Body subdued>Connect Strava on the SportOS website before importing activities here.</Body></Card>;
}
export function ProvidersScreen(){
 const {run,busy,error}=useOperation();const [data,setData]=useState<Connection[]|null>(null);
 const load=useCallback(()=>{void run(async api=>connections(await api.read('/providers/connections')),setData,'Could not read provider connections. Check your connection and retry.')},[run]);
 useFocusEffect(useCallback(()=>{setData(null);load()},[load]));
 return <Screen nested eyebrow="CONNECTIONS" title="Providers">
  <Body subdued>Import new or changed Strava activities. You can leave this screen while sync runs.</Body>
  {busy&&data===null?<StatusPanel kind="loading" message="Reading provider connections…"/>:null}
  {error?<StatusPanel kind="error" message={error} retry={load}/>:null}
  {data?.length===0?<Card title="No Strava connection"><Body>Connect Strava through the SportOS website first, then refresh this screen.</Body></Card>:null}
  {data?.map(c=><StravaConnectionCard key={c.id+':'+c.status} connection={c}/>)}
  <Action title="Refresh connections" secondary disabled={busy} onPress={load}/>
 </Screen>;
}
