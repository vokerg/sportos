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
export function GarminDayCard({date,onLoaded}:{date:string;onLoaded?:(hasData:boolean)=>void}){
 const {palette}=useSportosTheme();const {run,busy,error}=useOperation();const [data,setData]=useState<GarminDay|null>(null);const [message,setMessage]=useState('');const [expanded,setExpanded]=useState(false);
 const accept=useCallback((next:GarminDay)=>{setData(next);onLoaded?.(next.categories.some(c=>c.metrics.length>0||c.retained))},[onLoaded]);
 const load=useCallback(()=>{void run(async api=>garminDay(await api.read(dayPath(date)),date),accept,'Couldn’t load Garmin. Try again.')},[run,date,accept]);
 useFocusEffect(useCallback(()=>{setData(null);setMessage('');setExpanded(false);load()},[load]));
 const metrics=data?.categories.flatMap(c=>c.metrics)??[];const hasData=metrics.length>0;
 const main=primary.flatMap(key=>metrics.filter(m=>m.key===key));const extra=metrics.filter(m=>!primary.includes(m.key));
 const visible=expanded?metrics:main.length?main:extra.slice(0,6);
 const failures=data?.categories.filter(c=>['failed','rate_limited','authentication_required'].includes(c.state))??[];
 const refresh=()=>{if(!data?.fetchEnabled)return;setMessage('');void run(async api=>garminDay(await api.mutate(dayPath(date),{refresh:hasData}),date),next=>{accept(next);setMessage(next.categories.some(c=>['failed','rate_limited','authentication_required'].includes(c.state))?'Some metrics couldn’t update. Previous values are shown where available.':'Garmin updated.')},'Garmin couldn’t update. Your previous data is safe. Try again.')};
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
  {data?.fetchEnabled?<><Action title={busy?'Updating Garmin…':hasData?'Refresh Garmin':'Load Garmin'} disabled={busy} onPress={refresh}/><Body subdued>Updates Garmin metrics. Your score stays unchanged.</Body></>:data?<Body subdued>Garmin sync isn’t available here. Your saved measurements are still shown.</Body>:null}
  {message?<Body subdued>{message}</Body>:null}{error?<><Body subdued>{error}</Body><Action title="Try again" secondary disabled={busy} onPress={load}/></>:null}
 </Card>;
}
