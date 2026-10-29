import React,{useCallback,useState} from 'react';
import {ScrollView,Text,TextInput,View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeBottomTabScreenProps} from '@bottom-tabs/react-navigation';
import type {NativeStackNavigationProp,NativeStackScreenProps} from '@react-navigation/native-stack';
import {useScreenSession as useSession} from '../auth/useScreenSession';
import {Action,Body,Card,Metric,Screen,SourceBadge,StatusPanel,formatDistance,formatDuration,formatPace} from '../ui/primitives';
import {useSportosTheme} from '../ui/theme';
import {localToday,shiftCalendarDate} from '../ui/format.mjs';
import type {MainTabs,RootStack} from '../navigation/routes';
import {TARGETS,leaderboardPath,projectLeaderboard,projectEvent,type Leaderboard,type EventDetail} from './model.mjs';
export function RunLabScreen({navigation}:NativeBottomTabScreenProps<MainTabs,'RunLab'>){
 const {read}=useSession();const {palette}=useSportosTheme();
 const [showCoverage,setShowCoverage]=useState(false);
 const [showRange,setShowRange]=useState(false);
 const [distanceM,setDistance]=useState(5000);const [from,setFrom]=useState('');const [to,setTo]=useState('');
 const [query,setQuery]=useState({distanceM:5000,from:'',to:'',offset:0});
 const [result,setResult]=useState<Leaderboard|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [revision,setRevision]=useState(0);
 useFocusEffect(useCallback(()=>{let active=true;setResult(null);setBusy(true);setError(null);
  void read<unknown>(leaderboardPath(query)).then(projectLeaderboard).then(data=>{if(active)setResult(data);}).catch(()=>{if(active)setError('Could not load qualified records. Check your connection and retry.');}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[read,query,revision]));
 const apply=()=>{try{leaderboardPath({distanceM,from,to});setQuery({distanceM,from,to,offset:0});}catch{setError('Enter valid YYYY-MM-DD dates with From before To.');}};
 const stack=navigation.getParent<NativeStackNavigationProp<RootStack>>();
 return <Screen eyebrow="CHASE YOUR NEXT BEST" title="Run Lab">
  <Body subdued>Original Excel achievements and measured windows. Timing and evidence stay labelled.</Body>
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>{TARGETS.map(m=><Action key={m} title={m===21097.5?'Half marathon':m===42195?'Marathon':m/1000+' km'} secondary={distanceM!==m} onPress={()=>{setDistance(m);setQuery(q=>({...q,distanceM:m,offset:0}));}}/>)}</ScrollView>
  <Card title="Date range">
   <Body subdued>{query.from||'All history'}{query.to?' → '+query.to:''}</Body>
   <Action title={showRange?'Hide range controls':'Change date range'} secondary onPress={()=>setShowRange(v=>!v)}/>
   {showRange?<>

   <View style={{flexDirection:'row',gap:8}}>{[30,365,0].map(days=><View style={{flex:1}} key={days}><Action title={days?days+' days':'All time'} secondary onPress={()=>{const f=days?shiftCalendarDate(localToday(),1-days):'';const t=days?localToday():'';setFrom(f);setTo(t);setQuery({distanceM,from:f,to:t,offset:0});}}/></View>)}</View>
   {[['From',from,setFrom],['To',to,setTo]].map(([label,value,setter])=><TextInput key={String(label)} accessibilityLabel={String(label)+' date YYYY-MM-DD'} placeholder={label+' YYYY-MM-DD (optional)'} placeholderTextColor={palette.muted} value={value as string} onChangeText={setter as (s:string)=>void} autoCapitalize="none" maxLength={10} style={{color:palette.text,borderColor:palette.border,borderWidth:1,borderRadius:10,padding:14,minHeight:48}}/>)}
   <Action title="Apply range" secondary disabled={busy} onPress={()=>{apply();setShowRange(false);}}/>
   </>:null}
  </Card>
  {busy?<StatusPanel kind="loading" message="Reading qualified records…"/>:null}
  {error?<StatusPanel kind="error" message={error} retry={()=>setRevision(n=>n+1)}/>:null}
  {result?<>
   <Card title="Evidence coverage"><Body>{result.coverage.measuredCurrent} current measured / {result.coverage.eligibleRuns} eligible linked runs</Body>
    <Action title={showCoverage?'Hide coverage details':'Show coverage details'} secondary onPress={()=>setShowCoverage(v=>!v)}/>
    {showCoverage?<>
    <Body subdued>Excel: {result.coverage.legacyLinked} linked · {result.coverage.legacyUnmatched} unlinked · {result.coverage.legacyAmbiguous} ambiguous</Body>
    <Body subdued>{result.coverage.estimatedOnly} estimated only · {result.coverage.unprocessed} unprocessed · {result.coverage.staleOrFailed} stale/failed · {result.coverage.missingRichDetail} missing rich detail · {result.coverage.unavailable} unavailable</Body>
    <Body subdued>Coverage categories can overlap. Missing processing may hide faster runs. Estimates and stale efforts never rank.</Body>
    </>:null}
   </Card>
   {!result.rows.length?<StatusPanel kind="empty" message="No qualified records for this distance and range."/>:null}
   {result.rows.map(row=><Card key={row.id}>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:16}}>
      <View style={{backgroundColor:row.rank===1?palette.lime:palette.soft,paddingHorizontal:14,paddingVertical:9,borderRadius:12}}>
        <Text style={{color:row.rank===1?'#1B3025':palette.accent,fontSize:20,fontWeight:'800'}}>#{row.rank}</Text>
      </View><Text style={{color:palette.muted,fontSize:13}}>{row.date}</Text>
    </View>
    <Metric label={formatDistance(result.targetDistanceM)} value={formatDuration(row.durationS)}/>
    <SourceBadge label={row.source==='excel'?'Original Excel':'Measured '+row.source}/>
    <Body subdued>{row.pausePolicy==='historical_excel'?'Historical timing':row.pausePolicy==='moving_flags'?'Moving time':'Timer-active time'}</Body>
    {row.activityId?<Action title="Open run" secondary onPress={()=>stack?.navigate('ActivityDetail',{activityId:row.activityId!})}/>:null}
    {row.eventId?<Action title="Inspect original achievement" secondary onPress={()=>stack?.navigate('PerformanceDetail',{eventId:row.eventId!})}/>:null}
    {row.alternativeCount?<Body subdued>{row.alternativeCount} alternative records; showing {row.alternatives.length}.</Body>:null}
    {row.alternatives.map((a,i)=><View key={i} style={{gap:8}}><Body>{a.source} · {formatDuration(a.durationS)}</Body>{a.eventId?<Action title={'Inspect alternative '+(i+1)} secondary onPress={()=>stack?.navigate('PerformanceDetail',{eventId:a.eventId!})}/>:null}</View>)}
   </Card>)}
   <Body subdued>{result.rows.length?result.offset+1:0}–{result.offset+result.rows.length} of {result.total}</Body>
   <View style={{flexDirection:'row',gap:8}}><View style={{flex:1}}><Action title="Previous page" secondary disabled={busy||!result.offset} onPress={()=>setQuery(q=>({...q,offset:Math.max(0,result.offset-result.limit)}))}/></View><View style={{flex:1}}><Action title="Next page" disabled={busy||result.offset+result.limit>=result.total} onPress={()=>setQuery(q=>({...q,offset:result.offset+result.limit}))}/></View></View>
  </>:null}
 </Screen>;
}
export function PerformanceDetailScreen({route,navigation}:NativeStackScreenProps<RootStack,'PerformanceDetail'>){
 const {read}=useSession();const [data,setData]=useState<EventDetail|null>(null);const [error,setError]=useState(false);const [revision,setRevision]=useState(0);
 useFocusEffect(useCallback(()=>{let active=true;setData(null);setError(false);
  void read<unknown>('/performance/events/'+encodeURIComponent(route.params.eventId)).then(projectEvent).then(d=>{if(active)setData(d);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};
 },[read,route.params.eventId,revision]));
 return <Screen nested title="Original achievement">
  {error?<StatusPanel kind="error" message="Original achievement is unavailable or offline." retry={()=>setRevision(n=>n+1)}/>:!data?<StatusPanel kind="loading" message="Reading historical evidence…"/>:null}
  {data?<Card title={data.date}><Metric label={formatDistance(data.distanceM)} value={formatDuration(data.durationS)}/><Body>{formatPace(data.paceSPerKm)} · {data.isTreadmill?'Treadmill':'Run'}</Body><SourceBadge label={data.source.replaceAll('_',' ')}/><Body>{data.provenance}</Body><Body subdued>{data.reconciliation}</Body>{data.activityId?<Action title="Open linked run" onPress={()=>navigation.navigate('ActivityDetail',{activityId:data.activityId!})}/>:null}</Card>:null}
 </Screen>;
}
