import React, { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeBottomTabScreenProps } from '@bottom-tabs/react-navigation';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { MobileApiError } from '../../../../packages/shared/src/mobile-api';
import { useScreenSession as useSession } from '../auth/useScreenSession';
import type { MainTabs, RootStack } from '../navigation/routes';
import { Action, Body, Card, Screen, SourceBadge, StatusPanel } from '../ui/primitives';
import { formatDuration, localToday } from '../ui/format.mjs';
import { useSportosTheme } from '../ui/theme';
import { activityDetailPath, activityDistance, activityListPath, effortRows, projectActivityDetail,
  projectActivityList, projectEnrichment, projectGarminSets, projectLaps, projectSwimLengths,
  providerLabel, summaryMetrics, title, validActivityId } from './model.mjs';
import type { Activity, ActivityDetail, ActivityList, Enrichment, GarminSetRows, RunLapBatch, SwimLengths } from './contracts';

type Kind = 'loading'|'loaded'|'empty'|'error'|'offline';
type Load<T> = { kind: Kind; data: T|null };
type Retained<T> = { kind: 'idle'|'loading'|'loaded'|'empty'|'error'; data:T|null };
const initial = <T,>():Load<T> => ({kind:'loading',data:null});
const errorKind = (error: unknown): Kind => error instanceof MobileApiError && error.kind === 'network' ? 'offline' : 'error';
const MAX_FEED_ROWS = 250;
const FILTER_TYPES = [
  ['all','All'],['run','Runs'],['swim','Swims'],['bike','Rides'],['workout','Gym'],
  ['walk','Walks'],['rowing','Rowing'],['sup','SUP'],['hiit','HIIT'],['steps','Steps'],['bonus','Bonus'],
] as const;
const FILTER_SOURCES = [
  ['all','All sources'],['strava','Strava'],['garmin','Garmin'],['manual','Manual'],
  ['my_sport_xlsx','My Sport XLSX'],['run_db_xlsx','Run DB XLSX'],['google_sheets','Sheets'],['fit','FIT'],
] as const;
const FILTER_RANGES = [['30d','30 days'],['90d','90 days'],['all','All time']] as const;

function Filters({ label, items, value, onChange }: {
  label:string;items:readonly (readonly [string,string])[];value:string;onChange:(value:string)=>void;
}) {
  const {palette} = useSportosTheme();
  return <View style={styles.filterGroup}>
    <Text style={[styles.smallLabel,{color:palette.muted}]}>{label}</Text>
    <View style={styles.chips}>{items.map(([key,name]) => <Pressable key={key} accessibilityRole="button"
      accessibilityLabel={name} accessibilityState={{selected:key===value}}
      onPress={() => onChange(key)} style={[styles.chip,{borderColor:palette.border,
        backgroundColor:key===value?palette.accent:palette.surface}]}>
      <Text style={{color:key===value?palette.accentText:palette.text,fontWeight:'600'}}>{name}</Text>
    </Pressable>)}</View>
  </View>;
}
function TextRow({label,value}: {label:string;value:string}) {
  const {palette} = useSportosTheme();
  return <View style={styles.textRow} accessible accessibilityLabel={label+': '+value}>
    <Text style={[styles.rowKey,{color:palette.muted}]}>{label}</Text>
    <Text style={[styles.rowValue,{color:palette.text}]}>{value}</Text>
  </View>;
}
function localActivityTime(startTime:string|null) {
  const parsed = startTime ? new Date(startTime) : null;
  return parsed && Number.isFinite(parsed.getTime())
    ? parsed.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}) : null;
}
function durationLabel(row:Activity) {
  const moving = row.activity_type !== 'swim' && row.moving_time_s !== null;
  const seconds = moving ? row.moving_time_s : row.duration_s;
  return seconds===null ? null : (moving?'Moving ':'Elapsed ')+formatDuration(seconds);
}
function activityInfo(row:Activity) {
  const extras = summaryMetrics(row).filter(m => ['Pace','Average speed','Average HR'].includes(m.label))
    .map(m => m.label+': '+m.value).slice(0,2);
  return [row.activity_date,localActivityTime(row.start_time),activityDistance(row),durationLabel(row),...extras]
    .filter(Boolean).join(' · ');
}
function ActivityRow({activity,onOpen}: {activity:Activity;onOpen():void}) {
  const {palette} = useSportosTheme();
  const heading = title(activity.activity_type)+(activity.subtype && !['outdoor','unknown'].includes(activity.subtype)
    ? ' · '+activity.subtype : '');
  const subtitle = activityInfo(activity);
  return <Pressable accessibilityRole="button" accessibilityLabel={heading+', '+subtitle+', source '+activity.source}
    onPress={onOpen} style={[styles.activityRow,{borderColor:palette.border}]}>
    <Text style={[styles.rowTitle,{color:palette.text}]}>{heading}</Text>
    <Text style={[styles.rowSub,{color:palette.muted}]}>{subtitle}</Text>
    <Text style={[styles.mini,{color:palette.accent}]}>{activity.source.replaceAll('_',' ')}
      {activity.historicalSummary?' · Historical reconstruction':''}
      {activity.distanceCorrection?' · Corrected distance':''}</Text>
    {activity.providerMetrics.map(p => <Text key={p.provider} style={[styles.mini,{color:palette.muted}]}>{providerLabel(p)}</Text>)}
  </Pressable>;
}

export function ActivitiesScreen({navigation}: NativeBottomTabScreenProps<MainTabs,'Activities'>) {
  const {read} = useSession();
  const [showFilters,setShowFilters] = useState(false);
  const [range,setRange] = useState<'30d'|'90d'|'all'>('90d');
  const [type,setType] = useState('all');
  const [source,setSource] = useState('all');
  const [revision,setRevision] = useState(0);
  const [view,setView] = useState<Load<ActivityList>>(initial());
  const [moreLoading,setMoreLoading] = useState(false);
  const [moreError,setMoreError] = useState(false);
  const generation = useRef(0);
  const loadingMore = useRef(false);
  const today = localToday();

  useFocusEffect(useCallback(() => {
    const request = ++generation.current;
    loadingMore.current = false;setMoreLoading(false);setMoreError(false);
    setView(initial());
    void read<unknown>(activityListPath({range,type,source,today})).then(projectActivityList).then(result => {
      if (generation.current === request) setView({kind:result.items.length?'loaded':'empty',data:result});
    }).catch(error => {
      if (generation.current === request) setView({kind:errorKind(error),data:null});
    });
    return () => {generation.current++};
  },[read,range,type,source,revision,today]));

  const retry = () => setRevision(n=>n+1);
  const more = () => {
    const data = view.data;
    if (!data || loadingMore.current || data.offset+data.items.length>=data.count || data.items.length>=MAX_FEED_ROWS || data.items.length===0) return;
    const offset = data.offset+data.items.length, request = generation.current;
    if (offset > 100000) return;
    loadingMore.current=true;setMoreLoading(true);setMoreError(false);
    void read<unknown>(activityListPath({range,type,source,offset,limit:25,today})).then(projectActivityList).then(page => {
      if (generation.current !== request) return;
      if (page.offset !== offset || page.items.length === 0) throw new Error('Inconsistent activity pagination');
      const ids = new Set(data.items.map(row=>row.id));
      const merged = [...data.items,...page.items.filter(row=>!ids.has(row.id))];
      // Offset tracks consumed server rows even when live insertions create duplicate IDs.
      setView({kind:'loaded',data:{...page,offset:page.offset+page.items.length-merged.length,items:merged}});
    }).catch(() => {if(generation.current===request)setMoreError(true)})
      .finally(() => {if(generation.current===request){loadingMore.current=false;setMoreLoading(false)}});
  };
  const data = view.data;
  const hasMore = data ? data.offset+data.items.length<data.count && data.items.length>0 && data.items.length<MAX_FEED_ROWS && data.offset+data.items.length<=100000 : false;
  return <Screen eyebrow="Your canonical history" title="Activities">
    <Card title="History filters">
      <Body subdued>{FILTER_RANGES.find(([key])=>key===range)?.[1]} · {FILTER_TYPES.find(([key])=>key===type)?.[1]} · {FILTER_SOURCES.find(([key])=>key===source)?.[1]}</Body>
      <Action title={showFilters?'Done with filters':'Change filters'} secondary onPress={()=>setShowFilters(v=>!v)}/>
      {showFilters?<>

      <Filters label="Date window" items={FILTER_RANGES} value={range} onChange={v=>setRange(v as typeof range)} />
      <Filters label="Sport" items={FILTER_TYPES} value={type} onChange={setType} />
      <Filters label="Origin" items={FILTER_SOURCES} value={source} onChange={setSource} />
      </>:null}
    </Card>
    {view.kind==='loading'?<StatusPanel kind="loading" message="Reading canonical activities…" />:null}
    {['error','offline'].includes(view.kind)?<StatusPanel kind={view.kind as 'error'|'offline'}
      message={view.kind==='offline'?'Offline. Activity history is not cached.':'Could not load canonical activities.'} retry={retry}/>:null}
    {view.kind==='empty'?<StatusPanel kind="empty" message="No activities match these filters. Missing history is not a zero-distance session." retry={retry}/>:null}
    {data?<>
      <Body>{data.count.toLocaleString('en-US')} activities matching the selected filters · server data</Body>
      <Card title="Training sessions">
        {data.items.map(row=><ActivityRow key={row.id} activity={row} onOpen={()=>navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('ActivityDetail',{activityId:row.id})}/>)}
        {moreError?<Body subdued>Could not load the next page; existing rows remain available.</Body>:null}
        {moreLoading?<StatusPanel kind="loading" message="Loading older activities…" />:null}
        {hasMore?<Action title="Load older activities" secondary disabled={moreLoading} onPress={more}/>:null}
        {data.items.length>=MAX_FEED_ROWS && data.offset+data.items.length<data.count ?
          <Body subdued>Showing the first 250 records to keep this screen responsive. Narrow the date or sport filter for older activities.</Body>:null}
        {data.offset+data.items.length>100000 ? <Body subdued>API pagination limit reached; choose a narrower date range.</Body>:null}
      </Card>
      <Action title="Refresh activities" secondary onPress={retry} />
    </>:null}
  </Screen>;
}

function SplitChart({label,values,formatter}: {label:string;values:Array<number|null>;formatter:(n:number)=>string}) {
  const {palette} = useSportosTheme();
  const [selected,setSelected] = useState<number|null>(null);
  const capped=values.slice(0,60);
  const finite=capped.filter((n):n is number=>n!==null && Number.isFinite(n) && n>0);
  if (!finite.length) return null;
  const max=Math.max(...finite,1);
  return <View>
    <Body subdued>{label} · recorded order. Tap a bar to inspect; the numeric rows remain below.</Body>
    <ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel={label+' chart'} contentContainerStyle={styles.bars}>
      {capped.map((value,i)=><Pressable key={i} accessibilityRole="button"
        accessibilityLabel={label+' '+(i+1)+': '+(value===null?'not recorded':formatter(value))}
        accessibilityState={{selected:selected===i}} onPress={()=>setSelected(i)}
        style={[styles.barSlot,{borderColor:selected===i?palette.accent:palette.border}]}>
        <View style={{height:value===null?3:Math.max(3,Math.round(value/max*88)),width:24,
          backgroundColor:palette.chart,borderRadius:4}} />
        <Text style={{color:palette.muted,fontSize:11}}>{i+1}</Text>
      </Pressable>)}
    </ScrollView>
    {selected!==null&&selected<capped.length?<Body>{label} {selected+1}: {capped[selected]===null?'Not recorded':formatter(capped[selected]!)}</Body>:null}
    {values.length>60?<Body subdued>Chart shows first 60 recorded splits; the table below loads more.</Body>:null}
  </View>;
}
function SplitTable({rows,renderRow}: {rows:{row:number}[];renderRow:(index:number)=>React.ReactNode}) {
  const [visible,setVisible] = useState(40);
  return <View style={styles.splitTable}>
    {rows.slice(0,visible).map((row,i)=><React.Fragment key={row.row+'-'+i}>{renderRow(i)}</React.Fragment>)}
    {rows.length>visible?<Action title={'Show next '+Math.min(40,rows.length-visible)+' recorded splits'}
      secondary onPress={()=>setVisible(v=>Math.min(v+40,rows.length))}/>:null}
  </View>;
}
function swimPace(s:number) {return formatDuration(s)+' /100 m'}
function SwimSplits({data}: {data:SwimLengths}) {
  if (data.status==='unavailable') return <Card title="Pool lengths">
    <Body subdued>Individual FIT lengths are not available ({data.reason??'no retained evidence'}). No splits are inferred from total distance.</Body>
  </Card>;
  return <Card title="Pool lengths · Garmin FIT">
    <TextRow label="Pool size" value={data.poolLengthM===null?'Not recorded':data.poolLengthM+' m'} />
    <TextRow label="Recorded lengths" value={String(data.lengths.length)} />
    <TextRow label="Evidence coverage" value={data.complete===true?'Complete reported count':data.complete===false?'Incomplete or mismatched':'Unconfirmed'} />
    {data.recordedDistanceM!==null && data.effectiveDistanceM!==null && data.recordedDistanceM!==data.effectiveDistanceM?
      <TextRow label="Original / corrected distance" value={data.recordedDistanceM+' m / '+data.effectiveDistanceM+' m'}/>:null}
    {data.truncated?<Body subdued>FIT length display is capped by the backend; not all lengths are shown.</Body>:null}
    <SplitChart label="Length pace" values={data.lengths.map(r=>r.kind==='active'?r.paceSPer100M:null)} formatter={swimPace}/>
    <SplitChart label="SWOLF" values={data.lengths.map(r=>r.kind==='active'?r.swolf:null)} formatter={n=>String(Math.round(n))}/>
    <SplitChart label="Strokes per length" values={data.lengths.map(r=>r.kind==='active'?r.strokes:null)} formatter={n=>String(Math.round(n))}/>
    <SplitTable rows={data.lengths} renderRow={i=>{
      const r=data.lengths[i]!;
      return <TextRow label={'#'+r.row+' · '+r.kind+(r.lengthNumber===null?'':' · length '+r.lengthNumber)}
        value={[
          r.durationS===null?'No time':formatDuration(r.durationS)+(r.durationBasis?' '+r.durationBasis:''),
          r.paceSPer100M===null?'':'Pace '+swimPace(r.paceSPer100M),
          r.strokes===null?'':'Strokes '+r.strokes,
          r.swolf===null?'':'SWOLF '+r.swolf,
          r.stroke??'',
        ].filter(Boolean).join(' · ')}/>;
    }}/>
  </Card>;
}
function RunSplits({data,source}: {data:RunLapBatch;source:'strava'|'garmin'}) {
  return <Card title={(source==='strava'?'Strava':'Garmin FIT')+' recorded running laps'}>
    {data.rows.length===0?<Body subdued>No recorded laps retained for this provider.</Body>:<>
      <SplitChart label="Lap pace" values={data.rows.map(r=>r.paceSPerKm)} formatter={n=>formatDuration(n)+' /km'}/>
      <SplitChart label="Lap heart rate" values={data.rows.map(r=>r.heartRate)} formatter={n=>Math.round(n)+' bpm'}/>
      <SplitTable rows={data.rows} renderRow={i=>{
        const r=data.rows[i]!;
        return <TextRow label={'Lap '+r.row} value={[
          r.distanceM===null?'Distance missing':activityDistance({activity_type:'run',distance_m:r.distanceM} as Activity),
          r.durationS===null?'No time':formatDuration(r.durationS)+(r.basis?' '+r.basis:''),
          r.paceSPerKm===null?'':'Pace '+formatDuration(r.paceSPerKm)+'/km',
          r.heartRate===null?'':'HR '+Math.round(r.heartRate)+' bpm',
        ].filter(Boolean).join(' · ')}/>;
      }}/>
    </>}
    {data.truncated?<Body subdued>Additional recorded laps omitted after the display cap.</Body>:null}
  </Card>;
}
function StrengthSets({rows}: {rows:GarminSetRows}) {
  return <Card title="Garmin FIT recorded sets">
    {rows.length? <SplitTable rows={rows.map((_,i)=>({row:i+1}))}
      renderRow={i=><TextRow label={'Set '+(i+1)} value={rows[i]!.map(r=>r.label+': '+r.value).join(' · ')}/>}
      />:<Body subdued>No individual exercise sets were retained.</Body>}
    <Body subdued>Exercise labels reflect native source evidence, not a computed workout plan.</Body>
  </Card>;
}

export function ActivityDetailScreen({route,navigation}:NativeStackScreenProps<RootStack,'ActivityDetail'>) {
  const id=route.params.activityId;
  const {read,mutate}=useSession();
  const [revision,setRevision] = useState(0);
  const [detail,setDetail] = useState<Load<ActivityDetail>>(initial());
  const [enrichment,setEnrichment] = useState<Enrichment|null>(null);
  const [coverageError,setCoverageError] = useState(false);
  const [swim,setSwim] = useState<Retained<SwimLengths>>({kind:'idle',data:null});
  const [laps,setLaps] = useState<Retained<RunLapBatch> & {source:'strava'|'garmin'|null}>({kind:'idle',data:null,source:null});
  const [sets,setSets] = useState<Retained<GarminSetRows>>({kind:'idle',data:null});
  const [providerOp,setProviderOp] = useState<'strava'|'garmin'|null>(null);
  const [providerMessage,setProviderMessage] = useState<string|null>(null);
  const generation=useRef(0);
  const lapRequest=useRef(0);
  const setRequest=useRef(0);
  const providerInFlight=useRef(false);

  useFocusEffect(useCallback(()=>{
    const current=++generation.current;
    lapRequest.current++;setRequest.current++;
    setDetail(initial());setEnrichment(null);setCoverageError(false);
    setSwim({kind:'idle',data:null});setLaps({kind:'idle',data:null,source:null});
    setSets({kind:'idle',data:null});setProviderOp(null);setProviderMessage(null);
    if (!validActivityId(id)) {setDetail({kind:'error',data:null});return ()=>{generation.current++};}
    void read<unknown>(activityDetailPath(id)).then(projectActivityDetail).then(row=>{
      if (generation.current!==current) return;
      setDetail({kind:'loaded',data:row});
      void read<unknown>(activityDetailPath(id)+'/enrichment').then(projectEnrichment).then(result=>{
        if(generation.current===current)setEnrichment(result);
      }).catch(()=>{if(generation.current===current)setCoverageError(true)});
      if (row.activity_type==='swim' && row.subtype!=='outdoor') {
        setSwim({kind:'loading',data:null});
        void read<unknown>(activityDetailPath(id)+'/swim-lengths').then(projectSwimLengths).then(result=>{
          if(generation.current===current)setSwim({kind:'loaded',data:result});
        }).catch(error=>{
          if(generation.current===current)setSwim({kind:'error',data:null});
        });
      }
    }).catch(error=>{if(generation.current===current)setDetail({kind:errorKind(error),data:null})});
    return ()=>{generation.current++;lapRequest.current++;setRequest.current++};
  },[id,read,revision]));

  const reload=()=>setRevision(v=>v+1);
  const viewLaps=(source:'strava'|'garmin')=>{
    const current=generation.current, request=++lapRequest.current;
    setLaps({kind:'loading',data:null,source});
    void read<unknown>(activityDetailPath(id)+(source==='strava'?'/provider-detail':'/garmin-detail'))
      .then(payload=>projectLaps(payload,source)).then(data=>{
        if(generation.current===current && lapRequest.current===request)setLaps({kind:data.rows.length?'loaded':'empty',data,source});
      }).catch(()=>{if(generation.current===current && lapRequest.current===request)setLaps({kind:'error',data:null,source})});
  };
  const viewSets=()=>{
    const current=generation.current, request=++setRequest.current;setSets({kind:'loading',data:null});
    void read<unknown>(activityDetailPath(id)+'/garmin-detail').then(projectGarminSets).then(rows=>{
      if(generation.current===current && setRequest.current===request)setSets({kind:rows.length?'loaded':'empty',data:rows});
    }).catch(()=>{if(generation.current===current && setRequest.current===request)setSets({kind:'error',data:null})});
  };
  const fetchDetail=(source:'strava'|'garmin',refresh:boolean)=>{
    if(providerInFlight.current) return;
    providerInFlight.current=true;
    const current=generation.current;
    setProviderOp(source);setProviderMessage(null);
    void mutate<unknown>(activityDetailPath(id)+(source==='strava'?'/provider-detail':'/garmin-detail'),'POST',{refresh})
      .then(()=>{
        if(generation.current===current)reload();
      }).catch(()=>{
        if(generation.current===current)setProviderMessage('Could not fetch '+source+' detail. Check provider availability and try again.');
      }).finally(()=>{providerInFlight.current=false;if(generation.current===current)setProviderOp(null)});
  };
  const activity=detail.data;
  const safeId=validActivityId(id);
  return <Screen nested eyebrow="Canonical activity" title={activity?title(activity.activity_type):'Activity detail'}>
    {detail.kind==='loading'?<StatusPanel kind="loading" message="Reading activity facts…" />:null}
    {detail.kind==='offline'||detail.kind==='error'?<StatusPanel kind={detail.kind}
      message={detail.kind==='offline'?'Offline. No activity details are cached.':'Could not load this activity, or it is no longer available to this account.'}
      retry={safeId?reload:undefined}/>:null}
    {activity?<>
      <Card title={activity.name??title(activity.activity_type)}>
        <Body subdued>{activity.activity_date}{localActivityTime(activity.start_time)?' · '+localActivityTime(activity.start_time):''}
          {activity.subtype && !['outdoor','unknown'].includes(activity.subtype)?' · '+activity.subtype:''}</Body>
        <SourceBadge label={'Canonical · '+activity.source.replaceAll('_',' ')}/>
        {activity.provenance?<Body subdued>Source-record class: {activity.provenance}</Body>:null}
        {activity.historicalSummary?<Body subdued>Historical workbook reconstruction; original session count, start time and GPS are unknown.</Body>:null}
        {activity.activity_type==='walk'?<Body subdued>Walking activities do not independently earn activity points; steps remain in the daily step total.</Body>:null}
        {activity.activity_type==='swim' && activity.subtype==='indoor'?
          <Body subdued>Indoor pool workout · no GPS map.</Body>
          :activity.activity_type==='swim' || ['run','bike','walk','rowing','sup'].includes(activity.activity_type)
            ? <Action title="View retained GPS route" onPress={()=>navigation.navigate('RouteMap',{activityId:id})}/>
            :null}
        {activity.distanceCorrection?<><SourceBadge label="Audited distance correction"/>
          <TextRow label="Original distance" value={activity.distanceCorrection.recordedDistanceM+' m'}/>
          <TextRow label="Effective distance" value={activity.distanceCorrection.effectiveDistanceM+' m'}/>
        </>:null}
      </Card>
      <Card title="Sport metrics · canonical">
        {summaryMetrics(activity).length?summaryMetrics(activity).map(item=>
          <TextRow key={item.label} label={item.label} value={item.value}/>)
          :<Body subdued>No sport-specific numeric metrics are available in canonical data.</Body>}
      </Card>
      {activity.metricComparisons.length?<Card title="Provider metric selections">
        <Body subdued>Read-only values selected by the server. A selected value does not overwrite the canonical facts.</Body>
        {activity.metricComparisons.map((m,i)=><TextRow key={m.key+'-'+i} label={m.label}
          value={m.value.toLocaleString('en-US',{maximumFractionDigits:2})+' '+m.unit+' · '+m.source}/>)}
      </Card>:null}
      {activity.activity_type==='run'?<Card title="Distance efforts">
        {effortRows(activity.bestEfforts).length?effortRows(activity.bestEfforts).map((e,i)=>
          <TextRow key={i+'-'+e.provider} label={(e.distanceM/1000).toLocaleString('en-US',{maximumFractionDigits:3})+' km · '+e.provider}
            value={formatDuration(e.durationS)+' · '+e.status+' · '+(e.method==='summary_estimate'?'Average pace estimate':e.method==='fit_calculated'?'FIT timer':'Retained streams')}/>)
          :<Body subdued>No current measured or explicitly estimated best-effort projections are available. No split time is inferred.</Body>}
        {activity.bestEfforts.some(p=>p.state!=='current')?<Body subdued>Some provider effort projections are missing, stale or not calculated.</Body>:null}
      </Card>:null}
      {activity.garminStrength?<Card title="Garmin strength summary">
        <TextRow label="Working sets" value={String(activity.garminStrength.workingSets)}/>
        <TextRow label="Recorded sets" value={String(activity.garminStrength.totalRecordedSets)}/>
        <TextRow label="Warmup / rest markers" value={activity.garminStrength.warmupSets+' / '+activity.garminStrength.restMarkers}/>
        <Body subdued>{activity.garminStrength.complete?'Source summary complete':'Source summary partial or unconfirmed'}</Body>
        {activity.garminStrength.exercises.map((e,i)=><TextRow key={i} label={e.name} value={e.workingSets+' working sets'}/>)}
      </Card>:null}
      {activity.activity_type==='swim' && activity.subtype!=='outdoor'?<>
        {swim.kind==='loading'?<StatusPanel kind="loading" message="Reading retained pool FIT lengths…" />:null}
        {swim.kind==='error'?<StatusPanel kind="error" message="Pool length data cannot be read. Recorded splits are not inferred." retry={reload}/>:null}
        {swim.data?<SwimSplits data={swim.data}/>:null}
      </>:null}
      <Card title="Source coverage · read-only">
        <Body subdued>Canonical fields remain authoritative. Rich provider data is stored separately and optional.</Body>
        {activity.providerMetrics.length?activity.providerMetrics.map(row=>
          <Body key={row.provider}>{providerLabel(row)}</Body>)
          :<Body subdued>Provider metric status not reported.</Body>}
        {coverageError?<Body subdued>Detail availability could not be checked; Fetch controls are hidden.</Body>:null}
        {enrichment?<><TextRow label="Strava rich detail" value={enrichment.strava}/>
          <TextRow label="Garmin FIT detail" value={enrichment.garmin}/></>:null}
      </Card>
      {activity.activity_type==='run'?<Card title="Recorded running laps">
        <Body subdued>View reads only retained Strava/Garmin laps. No request to the provider is made by opening this screen.</Body>
        <Action title="View saved Strava laps" secondary disabled={!activity.linkedStrava || laps.kind==='loading'}
          onPress={()=>viewLaps('strava')}/>
        <Action title="View saved Garmin FIT laps" secondary disabled={!activity.linkedGarmin || laps.kind==='loading'}
          onPress={()=>viewLaps('garmin')}/>
        {laps.kind==='loading'?<StatusPanel kind="loading" message="Reading retained provider laps…"/>:null}
        {laps.kind==='error'?<Body subdued>Retained laps are missing or could not be read. Fetch detail is a separate explicit action.</Body>:null}
        {laps.kind==='empty'?<Body subdued>Provider detail was retained, but has no recorded laps.</Body>:null}
      </Card>:null}
      {laps.kind==='loaded'&&laps.data&&laps.source?<RunSplits data={laps.data} source={laps.source}/>:null}
      {activity.activity_type==='workout'?<Card title="Recorded exercise sets">
        <Body subdued>Only explicitly retained Garmin FIT sets are shown; no exercises are generated.</Body>
        <Action title="View saved Garmin sets" secondary disabled={!activity.linkedGarmin || sets.kind==='loading'} onPress={viewSets}/>
        {sets.kind==='loading'?<StatusPanel kind="loading" message="Reading retained exercise sets…"/>:null}
        {sets.kind==='error'?<Body subdued>Retained sets are unavailable or could not be read.</Body>:null}
        {sets.kind==='empty'?<Body subdued>No individual sets are retained in Garmin detail.</Body>:null}
      </Card>:null}
      {sets.kind==='loaded'&&sets.data?<StrengthSets rows={sets.data}/>:null}
      <Card title="Explicit provider detail fetch">
        <Body subdued>These actions may contact Strava or, where the local helper is enabled, Garmin and retain additional private data on the backend. No rich detail is fetched in the background.</Body>
        {enrichment && activity.linkedStrava && enrichment.strava!=='unavailable'?<>
          <Action title="Fetch Strava rich detail" disabled={providerOp!==null} onPress={()=>fetchDetail('strava',false)}/>
          {enrichment.strava==='cached'||enrichment.strava==='stale'?
            <Action title="Refresh Strava from provider" secondary disabled={providerOp!==null} onPress={()=>fetchDetail('strava',true)}/>:null}
        </>:null}
        {enrichment && enrichment.garminFetchEnabled?<>
          <Action title="Fetch Garmin FIT detail" disabled={providerOp!==null} onPress={()=>fetchDetail('garmin',false)}/>
          {enrichment.garmin==='cached'?<Action title="Refresh Garmin from helper" secondary disabled={providerOp!==null} onPress={()=>fetchDetail('garmin',true)}/>:null}
        </>:<Body subdued>Garmin Fetch is disabled unless the authenticated local desktop helper is explicitly enabled. Saved FIT data can still be viewed.</Body>}
        {providerOp?<StatusPanel kind="loading" message={'Fetching '+providerOp+' only because you requested it…'}/>:null}
        {providerMessage?<Body subdued>{providerMessage}</Body>:null}
      </Card>
      <Action title="Refresh canonical detail" secondary onPress={reload}/>
    </>:null}
  </Screen>;
}
const styles=StyleSheet.create({
  filterGroup:{gap:8},smallLabel:{fontSize:13,fontWeight:'700'},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:8},
  chip:{minHeight:44,borderRadius:10,borderWidth:1,paddingHorizontal:12,justifyContent:'center'},
  textRow:{flexDirection:'row',justifyContent:'space-between',gap:14,paddingVertical:9,borderBottomWidth:0},
  rowKey:{flex:1,fontSize:14,lineHeight:20},rowValue:{flex:2,fontSize:14,lineHeight:20,fontWeight:'600',textAlign:'right'},
  activityRow:{borderBottomWidth:1,paddingVertical:14,minHeight:62,gap:5},
  rowTitle:{fontSize:18,fontWeight:'700'},rowSub:{fontSize:14,lineHeight:21},
  mini:{fontSize:12,lineHeight:18},
  bars:{flexDirection:'row',alignItems:'flex-end',gap:5,paddingVertical:10},
  barSlot:{minWidth:44,minHeight:122,borderWidth:1,borderRadius:9,alignItems:'center',justifyContent:'flex-end',paddingBottom:5},
  splitTable:{gap:4},
});
