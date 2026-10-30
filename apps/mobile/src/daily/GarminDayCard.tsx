import {trackGarminJob} from '../providers/track-garmin-job';
import {garminJob,garminJobMessage,activeGarminJob,type GarminFetchJob} from '../providers/garmin-jobs';
import React,{useCallback,useState} from 'react';
import {Text,View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Action,Body,Card} from '../ui/primitives';
import {ProviderLogo} from '../ui/ProviderStatus';
import {useSportosTheme} from '../ui/theme';
import {categoryLabels,dayPath,garminDay,type GarminDay} from '../providers/model';
import {useOperation} from '../providers/use-operation';
import {formatDayMetric} from './garmin-metrics';
const primary=['sleep.sleepSeconds','summary.steps','heart_rate.restingBpm','hrv.lastNightAvgMs','weight.weightKg','stress.averageLevel'];
export function useGarminDay(date:string,onLoaded?:(hasData:boolean)=>void){
 const {run,busy,error}=useOperation();const cancellation=useOperation();const [job,setJob]=useState<GarminFetchJob|null>(null);const [data,setData]=useState<GarminDay|null>(null);const [message,setMessage]=useState('');
 const accept=useCallback((next:GarminDay)=>{setData(next);setJob(next.activeJob??null);onLoaded?.(next.categories.some(c=>c.metrics.length>0||c.retained))},[onLoaded]);
 const load=useCallback(()=>{void run(async api=>garminDay(await api.read(dayPath(date)),date),accept,'Couldn’t load Garmin. Try again.')},[run,date,accept]);
 useFocusEffect(useCallback(()=>{setData(null);setMessage('');load()},[load]));
 const refresh=()=>{
  if(!data?.fetchEnabled&&!activeGarminJob(job))return;setMessage('');
  void run(async api=>{
   const target={operation:'day' as const,date};
   const initial=job&&activeGarminJob(job)?garminJob(await api.read('/garmin/jobs/'+job.id),target):job&&['failed','cancelled'].includes(job.status)?garminJob(await api.mutate('/garmin/jobs/'+job.id+'/retry'),target):garminJob(await api.mutate(dayPath(date),{refresh:true}),target);
   const latest=await trackGarminJob(api,initial,target,next=>{setJob(next);setMessage(garminJobMessage(next))});
   const saved=garminDay(await api.read(dayPath(date)),date);return {saved,latest};
  },({saved,latest})=>{accept(saved);setJob(latest.status==='succeeded'?null:latest);setMessage(activeGarminJob(latest)?'Automatic checks paused. Check Garmin refresh status to continue.':garminJobMessage(latest))},'Could not finish checking Garmin. The worker job may continue; check status before retrying.');
 };
 const cancel=()=>{if(!job)return;void cancellation.run(api=>api.mutate('/garmin/jobs/'+job.id+'/cancel'),()=>setMessage('Cancellation requested. The worker will stop safely.'),'Could not request cancellation. Check status.')};

 return {data,busy:busy||cancellation.busy,error:error||cancellation.error,message,load,refresh,job,cancel};
}
export function GarminDayCard(props:{date:string;onLoaded?:(hasData:boolean)=>void}){
 const state=useGarminDay(props.date,props.onLoaded);
 return <GarminDayView state={state}/>;
}
export function GarminDayView({state,showAction=true}:{state:ReturnType<typeof useGarminDay>;showAction?:boolean}){
 const {palette}=useSportosTheme();const [expanded,setExpanded]=useState(false);
 const {data,busy,error,message,load,refresh,job,cancel}=state;
 const metrics=data?.categories.flatMap(c=>c.metrics)??[];const hasData=metrics.length>0;
 const main=primary.flatMap(key=>metrics.filter(m=>m.key===key));const extra=metrics.filter(m=>!primary.includes(m.key));
 const visible=expanded?metrics:main.length?main:extra.slice(0,6);
 const failures=data?.categories.filter(c=>['failed','rate_limited','authentication_required'].includes(c.state))??[];
 return <Card>
  <View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:10,alignItems:'center'}}>
   <ProviderLogo provider="garmin"/><Text style={{color:palette.muted,fontSize:12}}>{busy?'Updating…':data?.completeness==='in_progress'?'Today so far':hasData?'Daily health':''}</Text>
  </View>
  {hasData?<>
   <View style={{flexDirection:'row',flexWrap:'wrap',gap:18}}>{visible.map(m=><View key={m.key} style={{width:'46%',gap:5,paddingVertical:7}} accessible accessibilityLabel={m.label+': '+formatDayMetric(m)}>
    <Text style={{color:palette.text,fontSize:25,fontWeight:'700',letterSpacing:-0.7,fontVariant:['tabular-nums']}}>{formatDayMetric(m)}</Text>
    <Text style={{color:palette.muted,fontSize:12,lineHeight:18}}>{m.label}</Text>
   </View>)}</View>
   {extra.length>0?<Action title={expanded?'Fewer metrics':'More health metrics'} secondary onPress={()=>setExpanded(v=>!v)}/>:null}
  </>:<Body subdued>{busy?'Loading your Garmin day…':'No Garmin measurements for this day yet.'}</Body>}
  {failures.length>0?<Body subdued>{failures.map(c=>categoryLabels[c.category]).join(', ')} couldn’t update.{failures.some(c=>c.state==='authentication_required')?' Reconnect Garmin.':failures.some(c=>c.state==='rate_limited')?' Garmin is busy. Try later.':''}</Body>:null}
  {showAction&&data?.fetchEnabled?<><Action title={busy?'Updating Garmin…':hasData?'Refresh Garmin':'Load Garmin'} disabled={busy} onPress={refresh}/><Body subdued>Updates Garmin metrics. Your score stays unchanged.</Body></>:showAction&&data?<Body subdued>Garmin sync isn’t available here. Your saved measurements are still shown.</Body>:null}
  {job&&activeGarminJob(job)?<><Action title="Check Garmin refresh status" secondary disabled={busy} onPress={refresh}/><Action title="Cancel Garmin request" secondary onPress={cancel}/></>:null}
  {job&&['failed','cancelled'].includes(job.status)?<Action title="Retry Garmin request" secondary disabled={busy||!data?.fetchEnabled} onPress={refresh}/>:null}
  {message?<Body subdued>{message}</Body>:null}{error?<><Body subdued>{error}</Body><Action title="Try again" secondary disabled={busy} onPress={load}/></>:null}
 </Card>;
}
