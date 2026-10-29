import React,{useCallback,useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {Action,Body,Card,SourceBadge} from '../ui/primitives';
import {categoryLabels,dayPath,garminDay,type GarminDay} from '../providers/model';
import {useOperation} from '../providers/use-operation';
export function GarminDayCard({date}:{date:string}){
 const {run,busy,error}=useOperation();const [data,setData]=useState<GarminDay|null>(null);const [message,setMessage]=useState('');
 const load=useCallback(()=>{void run(async api=>garminDay(await api.read(dayPath(date)),date),setData,'Could not read Garmin evidence. Retry loading retained evidence.')},[run,date]);
 useFocusEffect(useCallback(()=>{setData(null);setMessage('');load()},[load]));
 const fetchDay=(refresh:boolean)=>{if(!data?.fetchEnabled)return;void run(async api=>garminDay(await api.mutate(dayPath(date),{refresh}),date),next=>{setData(next);setMessage('Garmin request finished. Check the categories below for partial failures. Official scores were not recalculated.')},'Garmin fetch failed or timed out. Previously retained evidence is safe. Reload evidence before retrying; check the API helper and Garmin login.')};
 return <Card title="Garmin day evidence">
  <Body subdued>Fetch missing evidence or explicitly refresh Garmin for this date. These actions retain source evidence and do not recalculate the official score.</Body>
  {data?<>
   <SourceBadge label={data.state+' · '+data.completeness.replaceAll('_',' ')}/>
   {data.completeness==='in_progress'?<Body subdued>This day is still in progress; retained categories may be incomplete.</Body>:null}
   {data.categories.map(c=><Body key={c.category}>{categoryLabels[c.category]}: {c.state.replaceAll('_',' ')}{c.retainedAt?' · retained '+new Date(c.retainedAt).toLocaleString():''}{c.retained&&c.state!=='available'?' · previous evidence retained':''}</Body>)}
   {!data.fetchEnabled?<Body subdued>Garmin downloads are unavailable on this API. They require its enabled Garmin helper and authenticated Garmin login; a running Strava worker alone does not enable them. Retained evidence can still be read.</Body>:<>
    <Action title={busy?'Working…':'Fetch missing Garmin evidence'} disabled={busy} onPress={()=>fetchDay(false)}/>
    <Action title="Refresh Garmin from provider" secondary disabled={busy} onPress={()=>fetchDay(true)}/>
   </>}
  </>:<Body subdued>{busy?'Reading retained Garmin evidence…':'No Garmin evidence loaded.'}</Body>}
  {message?<Body subdued>{message}</Body>:null}{error?<Body subdued>{error}</Body>:null}
  <Action title="Reload retained Garmin evidence" secondary disabled={busy} onPress={load}/>
 </Card>;
}
