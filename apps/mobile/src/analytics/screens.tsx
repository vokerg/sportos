import React,{useCallback,useState} from 'react';
import {ScrollView,TextInput,View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import Svg,{Circle,Line,Polyline} from 'react-native-svg';
import {useScreenSession as useSession} from '../auth/useScreenSession';
import {Action,Body,Card,Metric,Screen,StatusPanel} from '../ui/primitives';
import {useSportosTheme} from '../ui/theme';
import {localToday,shiftCalendarDate} from '../ui/format.mjs';
import {METRICS,WINDOWS,analyticsPath,projectMonthly,projectRolling,chartSegments,type Month,type Rolling} from './model.mjs';
const labels:Record<string,string>={score:'Official score',steps:'Steps',run:'Run',bike:'Bike',swim:'Swim',workout:'Workout',bonus:'Bonus points',rolling:'Dynamics',monthly:'Monthly Stats',total:'Total',average:'Daily average',activeDays:'Active days'};
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
    {segment.map(p=><Circle key={p.index} cx={p.x} cy={p.y} r={values.length>60?3:5} fill={palette.chart} onPress={()=>select(p.index)}/>)}
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
 const [range,setRange]=useState({from,to});const [months,setMonths]=useState<Month[]|null>(null);const [rolling,setRolling]=useState<Rolling|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [revision,setRevision]=useState(0);const [selected,setSelected]=useState<number|null>(null);const [showValues,setShowValues]=useState(false);const [visibleValues,setVisibleValues]=useState(50);
 useFocusEffect(useCallback(()=>{let active=true;setMonths(null);setRolling(null);setSelected(null);setVisibleValues(50);setError(null);setBusy(true);
  void read<unknown>(analyticsPath({mode,...range,metric,window})).then(raw=>{
   if(!active)return;if(mode==='monthly')setMonths(projectMonthly(raw));else setRolling(projectRolling(raw,metric,window));
  }).catch(()=>{if(active)setError('Could not load analytics. Check your range and connection, then retry.');}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};
 },[read,mode,range,metric,window,revision]));
 const unit=measure==='activeDays'?'active days':rolling?.unit??(['run','bike','swim'].includes(metric)?'metres':metric==='steps'?'steps':'points');
 const series=rolling?.points.map(p=>measure==='total'?p.total:measure==='average'?p.average:p.activeDays)??months?.map(m=>m.recordedDays===0?null:measure==='average'?m.values[metric].average:m.values[metric].total)??[];
 const dates=rolling?.points.map(p=>p.date)??months?.map(m=>m.key)??[];
 const selection=selected??Math.max(0,series.length-1);
 const apply=()=>{try{analyticsPath({mode,from,to,metric,window});setRange({from,to});}catch{setError('Use real YYYY-MM-DD dates with From before To. Dynamics supports up to 366 days; Monthly Stats up to 10 years.');}};
 return <Screen nested eyebrow="Canonical server analytics" title="Training trends">
  <Choices items={['rolling','monthly']} selected={mode} onSelect={s=>{setMode(s);setMeasure('total');}}/>
  <Choices items={METRICS} selected={metric} onSelect={setMetric}/>
  <Card title="Date range">
   <Body subdued>{range.from} → {range.to}</Body>
   <Action title={showRange?'Hide range controls':'Change date range'} secondary onPress={()=>setShowRange(v=>!v)}/>
   {showRange?<>

   <Choices items={['30 days','90 days','365 days']} selected="" onSelect={s=>{const f=shiftCalendarDate(localToday(),1-parseInt(s));const t=localToday();setFrom(f);setTo(t);setRange({from:f,to:t});}}/>
   <TextInput accessibilityLabel="From date YYYY-MM-DD" value={from} onChangeText={setFrom} maxLength={10} style={{minHeight:48,padding:12,borderWidth:1,borderColor:palette.border,color:palette.text,borderRadius:10}}/>
   <TextInput accessibilityLabel="To date YYYY-MM-DD" value={to} onChangeText={setTo} maxLength={10} style={{minHeight:48,padding:12,borderWidth:1,borderColor:palette.border,color:palette.text,borderRadius:10}}/>
   <Action title="Apply range" secondary disabled={busy} onPress={()=>{apply();setShowRange(false);}}/>
   </>:null}
  </Card>
  {mode==='rolling'?<Choices items={WINDOWS.map(n=>n+' day window')} selected={window+' day window'} onSelect={s=>setWindow(parseInt(s))}/>:null}
  <Choices items={mode==='rolling'?['total','average','activeDays']:['total','average']} selected={measure} onSelect={setMeasure}/>
  <Body subdued>{mode==='rolling'?'Daily trailing windows; average uses all calendar days in the window. Active days count positive values.':'Calendar month totals; average uses recorded days. Distances and points are separate below.'} Values are persisted API truth. Today and partial windows may be incomplete.</Body>
  {busy?<StatusPanel kind="loading" message="Reading canonical analytics…"/>:null}
  {error?<StatusPanel kind="error" message={error} retry={()=>setRevision(n=>n+1)}/>:null}
  {series.length?<>
   <Card title={labels[metric]}><Chart values={series} dates={dates} select={setSelected}/>
    <Metric label={dates[selection]} value={value(series[selection],unit)}/>
    {rolling?.points[selection]?<Body subdued>{rolling.points[selection].recordedDays}/{rolling.points[selection].windowDays} recorded days · {rolling.points[selection].complete?'complete coverage':'partial coverage'} · daily value {value(rolling.points[selection].dailyValue,rolling.unit)}</Body>:null}
    {months?.[selection]?<Body subdued>{months[selection].recordedDays}/{months[selection].calendarDays} recorded days · {months[selection].partial?'partial month':'full month range'}</Body>:null}
    <View style={{flexDirection:'row',gap:8}}><View style={{flex:1}}><Action title="Previous value" secondary disabled={selection===0} onPress={()=>setSelected(selection-1)}/></View><View style={{flex:1}}><Action title="Next value" secondary disabled={selection===series.length-1} onPress={()=>setSelected(selection+1)}/></View></View>
   </Card>
   {months?.[selection]?<Card title="Monthly ledger"><Body subdued>Official total with server category points and recorded distance; imported/manual/calculated authority remains unchanged.</Body>
    <Body>Official score: {value(months[selection].values.score.total,'points')}</Body>
    {['run','bike','swim'].map(m=><Body key={m}>{labels[m]} distance: {value(months[selection].distances[m],'metres')}</Body>)}
    {Object.entries(months[selection].contributions).map(([k,n])=><Body key={k}>{k}: {value(n,'points')}</Body>)}
   </Card>:null}
   {metric==='score'&&rolling?.contributions.find(p=>p.date===dates[selection])?<Card title="Score contributions · calendar-day average">{Object.entries(rolling.contributions.find(p=>p.date===dates[selection])!.values).map(([k,n])=><Body key={k}>{k}: {value(n,'points/day')}</Body>)}</Card>:null}
   <Action title={showValues?'Hide numeric values':'Show exact numeric values'} secondary onPress={()=>setShowValues(v=>!v)}/>
   {showValues?<Card title="Numeric series">{dates.slice(0,visibleValues).map((d,i)=><Body key={d}>{d} · {value(series[i],unit)}</Body>)}{dates.length>visibleValues?<Action title="Show next 50 values" secondary onPress={()=>setVisibleValues(n=>n+50)}/>:null}</Card>:null}
  </>:!busy&&!error?<StatusPanel kind="empty" message="No canonical analytics for this range. No values are inferred."/>:null}
 </Screen>;
}
