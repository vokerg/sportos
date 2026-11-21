import React,{useCallback,useState,useMemo} from 'react';
import {ScrollView,TextInput,View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import Svg,{Circle,Line,Polyline} from 'react-native-svg';
import {useScreenSession as useSession} from '../auth/useScreenSession';
import {Action,Body,Card,Metric,Screen,StatusPanel} from '../ui/primitives';
import {useSportosTheme} from '../ui/theme';
import {localToday,shiftCalendarDate} from '../ui/format.mjs';
import {METRICS,WINDOWS,analyticsPath,historyPath,projectHistory,changeViewport,projectMonthly,chartSegments,type Month} from './model.mjs';
const labels:Record<string,string>={score:'Official score',steps:'Steps',run:'Run',bike:'Bike',swim:'Swim',workout:'Workout',bonus:'Power / bonus points',rolling:'Dynamics',monthly:'Monthly Stats',total:'Total',average:'Daily average',activeDays:'Active days'};
const value=(n:number|null|undefined,unit:string)=>n===null||n===undefined?'No data':n.toLocaleString(undefined,{maximumFractionDigits:2})+' '+unit;
function Choices({items,selected,onSelect}:{items:string[];selected:string;onSelect:(s:string)=>void}){
 return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>{items.map(s=><Action key={s} title={labels[s]??s} secondary={s!==selected} onPress={()=>onSelect(s)}/>)}</ScrollView>;
}
function Chart({values,dates,select}:{values:(number|null)[];dates:string[];select:(i:number)=>void}){
 const {palette}=useSportosTheme();const [width,setWidth]=useState(300);
 const segments=chartSegments(values,width);
 return <View onLayout={e=>setWidth(Math.max(100,e.nativeEvent.layout.width))}>
  <Svg width="100%" height={160} accessible={false}>
   <Line x1={8} y1={150} x2={width-8} y2={150} stroke={palette.border}/>
   {segments.map((segment,i)=><React.Fragment key={i}>
    <Polyline points={segment.map(p=>p.x+','+p.y).join(' ')} fill="none" stroke={palette.chart} strokeWidth={3}/>
    {segment.filter((_,i)=>i%Math.max(1,Math.ceil(values.length/150))===0).map(p=><Circle key={p.index} cx={p.x} cy={p.y} r={values.length>60?3:5} fill={palette.chart} onPress={()=>select(p.index)}/>)}
   </React.Fragment>)}
  </Svg>
  <Body subdued>{dates[0]??'No dates'} → {dates.at(-1)??'No dates'} · gaps mean no data</Body>
 </View>;
}
export function AnalyticsScreen(){
 const {read}=useSession();const {palette}=useSportosTheme();
 const [showRange,setShowRange]=useState(false);
 const [mode,setMode]=useState('rolling');const [metric,setMetric]=useState('score');const [window,setWindow]=useState(30);const [measure,setMeasure]=useState('total');
 const [from,setFrom]=useState(shiftCalendarDate(localToday(),-29));const [to,setTo]=useState(localToday());
 const [range,setRange]=useState({from,to});const [months,setMonths]=useState<Month[]|null>(null);
 const [history,setHistory]=useState<unknown>(null);const [zoom,setZoom]=useState<{start:number;end:number}|null>(null);const [valuePage,setValuePage]=useState(0);
 const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [revision,setRevision]=useState(0);const [selected,setSelected]=useState<number|null>(null);const [showValues,setShowValues]=useState(false);
 useFocusEffect(useCallback(()=>{let active=true;setMonths(null);setHistory(null);setZoom(null);setSelected(null);setValuePage(0);setError(null);setBusy(true);
  void read<unknown>(mode==='rolling'?historyPath(localToday()):analyticsPath({mode,...range,metric,window})).then(raw=>{
   if(!active)return;if(mode==='monthly')setMonths(projectMonthly(raw));else { projectHistory(raw,'score',30);setHistory(raw); }
  }).catch(()=>{if(active)setError('Could not load analytics. Check your range and connection, then retry.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};
 },[read,mode,mode==='monthly'?range:null,revision]));
 const fullRolling=useMemo(()=>{try{return history===null?null:projectHistory(history,metric,window);}catch{return null;}},[history,metric,window]);
 const visibleRolling=useMemo(()=>{
  if(!fullRolling)return null;
  const points=zoom?fullRolling.points.slice(zoom.start,zoom.end):fullRolling.points.filter(p=>p.date>=range.from&&p.date<=range.to);
  return {...fullRolling,points};
 },[fullRolling,zoom,range]);
 const records=fullRolling?.records.filter(r=>r.metric===metric&&[1,window].includes(r.windowDays)&&[localToday().slice(0,4),'all'].includes(r.period))??[];
 const rollingData=visibleRolling;
 const unit=measure==='activeDays'?'active days':rollingData?.unit??(['run','bike','swim'].includes(metric)?'metres':metric==='steps'?'steps':'points');
 const series=rollingData?.points.map(p=>measure==='total'?p.total:measure==='average'?p.average:p.activeDays)??months?.map(m=>m.recordedDays===0?null:measure==='average'?m.values[metric].average:m.values[metric].total)??[];
 const dates=rollingData?.points.map(p=>p.date)??months?.map(m=>m.key)??[];
 const selection=Math.min(selected??Math.max(0,series.length-1),Math.max(0,series.length-1));
 const apply=()=>{try{if(mode==='rolling'){historyPath(from);historyPath(to);if(from>to)throw new Error();}else analyticsPath({mode,from,to,metric,window});setError(null);setZoom(null);setSelected(null);setValuePage(0);setRange({from,to});}catch{setError('Use real YYYY-MM-DD dates with From before To. Monthly Stats supports up to 10 years.');}};
 return <Screen nested eyebrow="Canonical server analytics" title="Training trends">
  <Choices items={['rolling','monthly']} selected={mode} onSelect={s=>{setMode(s);setMeasure('total');}}/>
  <Choices items={METRICS} selected={metric} onSelect={setMetric}/>
  <Card title="Date range">
   <Body subdued>{range.from} → {range.to}</Body>
   <Action title={showRange?'Hide range controls':'Change date range'} secondary onPress={()=>setShowRange(v=>!v)}/>
   {showRange?<>

   <Choices items={mode==='rolling'?['30 days','90 days','365 days','All time']:['30 days','90 days','365 days']} selected="" onSelect={s=>{const f=s==='All time'?(fullRolling?.points[0]?.date??from):shiftCalendarDate(localToday(),1-parseInt(s));setZoom(null);setSelected(null);setValuePage(0);const t=localToday();setFrom(f);setTo(t);setRange({from:f,to:t});}}/>
   <TextInput accessibilityLabel="From date YYYY-MM-DD" value={from} onChangeText={setFrom} maxLength={10} style={{minHeight:48,padding:12,borderWidth:1,borderColor:palette.border,color:palette.text,borderRadius:10}}/>
   <TextInput accessibilityLabel="To date YYYY-MM-DD" value={to} onChangeText={setTo} maxLength={10} style={{minHeight:48,padding:12,borderWidth:1,borderColor:palette.border,color:palette.text,borderRadius:10}}/>
   <Action title="Apply range" secondary disabled={busy} onPress={()=>{apply();setShowRange(false);}}/>
   </>:null}
  </Card>
  {mode==='rolling'?<Choices items={WINDOWS.map(n=>n+' day window')} selected={window+' day window'} onSelect={s=>setWindow(parseInt(s))}/>:null}
  <Choices items={mode==='rolling'?['total','average','activeDays']:['total','average']} selected={measure} onSelect={setMeasure}/>
  <Body subdued>{mode==='rolling'?'Daily trailing windows; average uses all calendar days in the window. Active days count positive values.':'Calendar month totals; average uses recorded days. Distances and points are separate below.'} Values are persisted API truth. Today and partial windows may be incomplete.</Body>
  {busy?<StatusPanel kind="loading" message="Reading canonical analytics…"/>:null}
  {history!==null&&fullRolling===null?<StatusPanel kind="error" message="Analytics response could not be read." retry={()=>setRevision(n=>n+1)}/>:null}
  <Action title="Refresh data" secondary disabled={busy} onPress={()=>setRevision(n=>n+1)}/>
  {error?<StatusPanel kind="error" message={error} retry={()=>setRevision(n=>n+1)}/>:null}
  {series.length?<>
   {mode==='rolling'&&fullRolling?<>
     <Card title="All-time and calendar-year highs"><Body subdued>Rolling records are averages per calendar day; calendar year uses window end date. Coverage is shown. Today is provisional.</Body>
       {records.map(r=><Body key={r.period+':'+r.windowDays}>{r.period==='all'?'All time':r.period} · {r.windowDays===1?'Daily':r.windowDays+'d average'}: {value(r.value,fullRolling.unit)} · {r.date} · {r.recordedDays}/{r.windowDays} days</Body>)}
     </Card>
     <View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>
       {(['in','out','all','earlier','later'] as const).map(action=><Action key={action} title={{in:'Zoom in',out:'Zoom out',all:'Full history',earlier:'Earlier',later:'Later'}[action]} secondary onPress={()=>{
         setZoom(changeViewport(fullRolling.points.map(p=>p.date),range,zoom,action));setSelected(null);setValuePage(0);
       }}/>) }
     </View>
   </>:null}
   <Card title={labels[metric]}><Chart values={series} dates={dates} select={setSelected}/>
    <Metric label={dates[selection]} value={value(series[selection],unit)}/>
    {rollingData?.points[selection]?<Body subdued>{rollingData.points[selection].recordedDays}/{rollingData.points[selection].windowDays} recorded days · {rollingData.points[selection].complete?'complete coverage':'partial coverage'} · daily value {value(rollingData.points[selection].dailyValue,rollingData.unit)}</Body>:null}
    {months?.[selection]?<Body subdued>{months[selection].recordedDays}/{months[selection].calendarDays} recorded days · {months[selection].partial?'partial month':'full month range'}</Body>:null}
    <View style={{flexDirection:'row',gap:8}}><View style={{flex:1}}><Action title="Previous value" secondary disabled={selection===0} onPress={()=>setSelected(selection-1)}/></View><View style={{flex:1}}><Action title="Next value" secondary disabled={selection===series.length-1} onPress={()=>setSelected(selection+1)}/></View></View>
   </Card>
   {months?.[selection]?<Card title="Monthly ledger"><Body subdued>Official total with server category points and recorded distance; imported/manual/calculated authority remains unchanged.</Body>
    <Body>Official score: {value(months[selection].values.score.total,'points')}</Body>
    {['run','bike','swim'].map(m=><Body key={m}>{labels[m]} distance: {value(months[selection].distances[m],'metres')}</Body>)}
    {Object.entries(months[selection].contributions).map(([k,n])=><Body key={k}>{k}: {value(n,'points')}</Body>)}
   </Card>:null}
   {metric==='score'&&rollingData?.contributions.find(p=>p.date===dates[selection])?<Card title="Score contributions · calendar-day average">{Object.entries(rollingData.contributions.find(p=>p.date===dates[selection])!.values).map(([k,n])=><Body key={k}>{k}: {value(n,'points/day')}</Body>)}</Card>:null}
   <Action title={showValues?'Hide numeric values':'Show exact numeric values'} secondary onPress={()=>setShowValues(v=>!v)}/>
   {showValues?<Card title="Numeric series">{dates.slice(valuePage*50,(valuePage+1)*50).map((d,i)=><Body key={d}>{d} · {value(series[valuePage*50+i],unit)}</Body>)}<Body subdued>Page {valuePage+1} of {Math.max(1,Math.ceil(dates.length/50))}</Body><Action title="Previous page" secondary disabled={valuePage===0} onPress={()=>setValuePage(n=>n-1)}/><Action title="Next page" secondary disabled={(valuePage+1)*50>=dates.length} onPress={()=>setValuePage(n=>n+1)}/></Card>:null}
  </>:!busy&&!error?<StatusPanel kind="empty" message="No canonical analytics for this range. No values are inferred."/>:null}
 </Screen>;
}
