import { ActivityCard, projectActivityList, type ActivityList } from '../activities';
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeBottomTabScreenProps } from '@bottom-tabs/react-navigation';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { MobileApiError } from '../../../../packages/shared/src/mobile-api';
import { useScreenSession as useSession } from '../auth/useScreenSession';
import type { MainTabs, RootStack } from '../navigation/routes';
import { Action, Body, Card, DateStepper, formatDistance, Metric, NavigationRow, Screen, SourceBadge, StatusPanel } from '../ui/primitives';
import { isCalendarDate, localToday, shiftCalendarDate } from '../ui/format.mjs';
import { useSportosTheme } from '../ui/theme';
import { sourceLabel } from '../ui/source-label';
import { ProviderStatus } from '../ui/ProviderStatus';
import { StravaQuickSyncCard } from '../providers/screens';
import { useGarminDay, GarminDayView } from './GarminDayCard';
import { DayActions } from './DayActions';
import { useDayActions } from './day-actions';
import { homeAverages } from '../../../../packages/shared/src/home-summary';
import { SportMark } from '../ui/identity';
import { DayScoreCard } from './DayScoreCard';
import type { DailySummary, MobileDayDetail } from './contracts';
import { dailySummaryPath, formatPoints, mergeDays, safeActivityType, scoreAuthority, scoreBreakdownPath, projectDetail, parseDailySummaries } from './model.mjs';

type LoadKind = 'loading' | 'loaded' | 'empty' | 'error' | 'offline';
type HomeData = { days: DailySummary[]; activity: ActivityList | null; activityError: boolean; activityLoading: boolean; sports: Partial<Record<string, { count: number; distanceM: number }>> };
type Load<T> = { kind: LoadKind; data: T | null };
const INITIAL = { kind: 'loading' as const, data: null };

function errorKind(error: unknown): 'offline' | 'error' {
  return error instanceof MobileApiError && error.kind === 'network' ? 'offline' : 'error';
}
function TextLine({ children }: { children: React.ReactNode }) {
  const { palette } = useSportosTheme();
  return <Text style={[styles.line, { color: palette.muted }]}>{children}</Text>;
}
function CompactRow({ title, detail, sources, onPress }: { title: string; detail: string; sources?:DailySummary['providerSources']; onPress(): void }) {
  const { palette } = useSportosTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={title + ', ' + detail + (sources ? ', Strava: '+(sources.strava?'Data loaded':'No data')+', Garmin: '+(sources.garmin?'Data loaded':'No data') : '')}
    onPress={onPress} style={[styles.listRow, { borderColor: palette.border }]}>
    <View style={{flexDirection:'row',alignItems:'center',gap:10}}><Text style={[styles.rowTitle, { color: palette.text,flex:1 }]}>{title}</Text>{sources?<ProviderStatus sources={sources} compact/>:null}<Text style={{color:palette.muted,fontSize:22}} accessible={false}>›</Text></View>
    <Text style={[styles.rowDetail, { color: palette.muted }]}>{detail}</Text>
  </Pressable>;
}
/** Bounded calendar-window overview using canonical API evidence. */
export function HomeScreen({ navigation }: NativeBottomTabScreenProps<MainTabs, 'Home'>) {
  const { read } = useSession();
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<Load<HomeData>>(INITIAL);
  const today = localToday();

  useFocusEffect(useCallback(() => {
    let active = true;
    setView(INITIAL);
    void (async () => {
      try {
        const days = parseDailySummaries(await read<unknown>(dailySummaryPath({ limit: 30, from: shiftCalendarDate(today, -29), to: today })));
        if (!active) return;
        // Render official scores immediately; a slow activity query cannot delay the cockpit.
        setView({ kind: days.length ? 'loaded' : 'empty',
          data: { days, activity: null, activityError: false, activityLoading: true, sports: {} } });
        // Activities are a separate bounded canonical GET. Their failure must not hide official scores.
        let activity: ActivityList | null = null;
        let activityError = false;
        try {
          activity = projectActivityList(await read<unknown>('/activities?from=' + shiftCalendarDate(today, -29)
            + '&to=' + today + '&limit=3&offset=0'));
        } catch {
          activityError = true;
        }
        const sports: HomeData['sports'] = {};
        await Promise.all(['run', 'bike', 'swim'].map(async activityType => {
          try {
            const result = await read<{ summary: { count: number; distanceM: number } }>('/activities?from='
              + shiftCalendarDate(today, -6) + '&to=' + today + '&activityType=' + activityType + '&limit=1&offset=0');
            sports[activityType] = result.summary;
          } catch { activityError = true; }
        }));
        if (active) setView({ kind: days.length ? 'loaded' : 'empty', data: { days, activity, activityError, activityLoading: false, sports } });
      } catch (error) {
        if (active) setView({ kind: errorKind(error), data: null });
      }
    })();
    return () => { active = false; };
  }, [read, today, revision]));

  const retry = () => setRevision(v => v + 1);
  const averages = homeAverages(view.data?.days ?? [], shiftCalendarDate(today, -29), today);
  const { palette } = useSportosTheme();
  return <Screen eyebrow="SPORTOS" title="Your training">
    {view.kind === 'loading' ? <StatusPanel kind="loading" message="Loading your day…" /> : null}
    {view.kind === 'offline' || view.kind === 'error' ? <StatusPanel kind={view.kind}
      message={view.kind === 'offline' ? 'Offline. No score is cached or presented as current.'
        : 'Could not load daily scores from SportOS.'} retry={retry} /> : null}
    {view.kind === 'empty' ? <StatusPanel kind="empty" message="No scores yet. Sync your activities to get started." retry={retry} /> : null}
    {view.data ? <>
      <View style={{backgroundColor:palette.accent,borderRadius:24,padding:24,gap:10}}>
        <Text style={{color:palette.accentText,fontSize:13,fontWeight:'700'}}>YOUR 30-DAY RHYTHM</Text>
        <Text style={{color:palette.accentText,fontSize:42,fontWeight:'800',fontVariant:['tabular-nums']}}>{averages.score === null ? '—' : Math.round(averages.score).toLocaleString('en-US')} <Text style={{fontSize:16}}>pt / day</Text></Text>
        <Text style={{color:palette.accentText,fontSize:12}}>{shiftCalendarDate(today,-29)} — {today}</Text>
        <Text style={{color:palette.accentText,fontSize:12}}>{averages.count} of 30 days recorded · averages use recorded days</Text>
      </View>
      <Card title="Your daily rhythm · 30 days">
        <View style={styles.metrics}>
          <Metric label="Steps / day" value={averages.steps === null ? '—' : Math.round(averages.steps).toLocaleString('en-US')} />
          <Metric label="Workout pt / day" value={averages.workout === null ? '—' : Math.round(averages.workout).toLocaleString('en-US')} />
          <Metric label="Bonus pt / day" value={averages.bonus === null ? '—' : Math.round(averages.bonus).toLocaleString('en-US')} />
        </View>
      </Card>
      <Card title="Your week in motion">
        <Body subdued>Last 7 days · {shiftCalendarDate(today,-6)} — {today}</Body>
        {(['run','bike','swim'] as const).map((sport, index) => {
          const data = view.data?.sports[sport];
          return <View key={sport} style={{borderLeftWidth:3,borderLeftColor:['#14b8a6','#f59e0b','#6095ff'][index],paddingLeft:14,paddingVertical:8,flexDirection:'row',alignItems:'center',gap:12}}>
            <SportMark sport={sport} size={38}/>
            <View style={{flex:1,gap:4}}><Text style={{color:palette.text,fontSize:16,fontWeight:'700'}}>{['Running','Cycling','Swimming'][index]}</Text>
              <Body subdued>{data ? data.count + ' sessions' : view.data?.activityLoading ? 'Loading…' : 'Unavailable'}</Body>
              <Body subdued>30-day avg · {averages[sport] === null ? '—' : formatDistance(averages[sport])} / day</Body>
            </View><Text style={{color:palette.text,fontSize:22,fontWeight:'800'}}>{data ? formatDistance(data.distanceM) : '—'}</Text>
          </View>;
        })}
        <Body subdued>Totals from canonical activities; daily averages from scored records.</Body>
      </Card>
    </> : null}
    <StravaQuickSyncCard />
    {view.data ? <Card title="Recent sessions">
      {view.data.activityLoading ? <StatusPanel kind="loading" message="Reading recent activity summary…" />
        : view.data.activityError ? <><Body subdued>Some activity data is unavailable.</Body><Action title="Retry activities" secondary onPress={retry}/></>
        : view.data.activity?.count === 0 ? <Body subdued>No activities in the last 30 days.</Body>
        : <>
          <TextLine>{view.data.activity?.count ?? 0} activities · last 30 days</TextLine>
          {(view.data.activity?.items ?? []).map(a =>
            <ActivityCard key={a.id} activity={a}
              onOpen={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('ActivityDetail', { activityId: a.id })} />)}
        </>}
      <Action title="Open Activities" secondary onPress={() => navigation.navigate('Activities')} />
    </Card> : null}
    {view.data?.days.length ? <Card title="Your last three scored days">
      {view.data.days.slice(0,3).map(day => <CompactRow key={day.metric_date} title={day.metric_date}
        detail={formatPoints(day.total_points) + ' pt · ' + formatPoints(day.steps) + ' steps'}
        onPress={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('DailyDetail', {date:day.metric_date})} />)}
    </Card> : null}
    <Card>
      <NavigationRow title="Your daily journal" detail="Scores, activity and the story behind each day" icon="chart" onPress={() => navigation.navigate('Daily')} />
      {view.kind === 'loaded' ? <Action title="Refresh Home" secondary onPress={retry} /> : null}
    </Card>
  </Screen>;
}

/** A lightweight paged list. Selecting an arbitrary calendar date runs an exact date-only GET. */
export function DailyScreen({ navigation }: NativeBottomTabScreenProps<MainTabs, 'Daily'>) {
  const { read } = useSession();
  const [date, setDate] = useState(localToday());
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<Load<DailySummary[]>>(INITIAL);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const generation = useRef(0);
  const today = localToday();

  useFocusEffect(useCallback(() => {
    const current = ++generation.current;
    setHistory(INITIAL);
    setLoadingOlder(false);
    setOlderError(false);
    void read<unknown>(dailySummaryPath({ to: today, limit: 30 }))
      .then(payload => {
        const rows = parseDailySummaries(payload);
        if (generation.current !== current) return;
        setHistory({ kind: rows.length ? 'loaded' : 'empty', data: rows });
        setHasOlder(rows.length === 30);
      })
      .catch(error => {
        if (generation.current === current) setHistory({ kind: errorKind(error), data: null });
      });
    return () => { generation.current += 1; };
  }, [read, revision, today]));

  const loadOlder = () => {
    const rows = history.data;
    if (loadingOlder || !rows?.length || !hasOlder) return;
    const current = generation.current;
    setLoadingOlder(true);
    setOlderError(false);
    const before = shiftCalendarDate(rows[rows.length - 1].metric_date, -1);
    void read<unknown>(dailySummaryPath({ to: before, limit: 30 }))
      .then(payload => {
        const older = parseDailySummaries(payload);
        if (generation.current !== current) return;
        setHistory({ kind: 'loaded', data: mergeDays(rows, older) });
        setHasOlder(older.length === 30);
      })
      .catch(() => {
        if (generation.current === current) setOlderError(true);
      })
      .finally(() => { if (generation.current === current) setLoadingOlder(false); });
  };

  return <Screen eyebrow="DAILY" title="Daily journal">
    <Card>
      <DateStepper date={date} onChange={setDate} />
      <Action title="Open day" onPress={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('DailyDetail', {date})}/>
    </Card>
    <Card title="Score history">
      {history.kind === 'loading' ? <StatusPanel kind="loading" message="Loading saved score history…" /> : null}
      {history.kind === 'offline' || history.kind === 'error' ? <StatusPanel kind={history.kind}
        message="Cannot load score history. No offline snapshot is stored."
        retry={() => setRevision(v => v + 1)} /> : null}
      {history.kind === 'empty' ? <Body subdued>No saved days in your account yet.</Body> : null}
      {(history.data ?? []).map(row =>
        <CompactRow key={row.metric_date} title={row.metric_date}
          detail={formatPoints(row.total_points) + ' pt · ' + scoreAuthority(row.score_status)} sources={row.providerSources}
          onPress={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('DailyDetail', { date: row.metric_date })} />)}
      {olderError ? <Body subdued>Older records could not be loaded; retry when connected.</Body> : null}
      {hasOlder && history.kind === 'loaded' ?
        <Action title={loadingOlder ? 'Loading older days…' : 'Load older days'} secondary
          disabled={loadingOlder} onPress={loadOlder} /> : null}
      {history.kind === 'loaded' ? <Action title="Refresh history" secondary
        onPress={() => setRevision(v => v + 1)} /> : null}
    </Card>
  </Screen>;
}

export function DailyDetailScreen({ route,navigation }: NativeStackScreenProps<RootStack, 'DailyDetail'>) {
  return <DailyDetail key={route.params.date} date={route.params.date} navigation={navigation}/>;
}
function DailyDetail({date,navigation}:{date:string;navigation:NativeStackNavigationProp<RootStack,'DailyDetail'>}) {
  const { read } = useSession();
  const [revision, setRevision] = useState(0);
  const [coverage,setCoverage]=useState<{strava?:boolean;garmin?:boolean}>();
  const [garminLoaded,setGarminLoaded]=useState(false);
  const onGarminLoaded=useCallback((hasData:boolean)=>setGarminLoaded(hasData),[]);
  const [detail, setDetail] = useState<Load<MobileDayDetail>>(INITIAL);
  const garmin = useGarminDay(date,onGarminLoaded);
  const updated = useCallback((value:MobileDayDetail)=>{setDetail({kind:'loaded',data:value});setRevision(v=>v+1)},[]);
  const actions = useDayActions(date,updated);
  useFocusEffect(useCallback(() => {
    let active = true;
    setDetail(INITIAL);setCoverage(undefined);
    if (!isCalendarDate(date)) {
      setDetail({ kind: 'error', data: null });
      return () => { active = false; };
    }
    void (async () => {
      try {
        const summary = parseDailySummaries(await read<unknown>(dailySummaryPath({ from: date, to: date, limit: 1 })));
        if (!active) return;
        setCoverage(summary[0]?.providerSources);
        if (!summary.length) { setDetail({ kind: 'empty', data: null }); return; }
        const raw = await read<unknown>(scoreBreakdownPath(date));
        if (active) setDetail({ kind: 'loaded', data: projectDetail(raw) });
      } catch (error) {
        if (active) setDetail({ kind: errorKind(error), data: null });
      }
    })();
    return () => { active = false; };
  }, [date, read, revision]));

  const data = detail.data;
  const day = isCalendarDate(date) ? new Date(...(date.split('-').map(Number).map((n,i)=>i===1?n-1:n) as [number,number,number]),12) : null;
  const heading = day ? (date===localToday()?'Today':new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long'}).format(day)) : date;
  const subtitle = day ? new Intl.DateTimeFormat('en-GB',{weekday:'long'}).format(day)+' · '+day.getFullYear() : 'DAILY';
  return <Screen nested eyebrow={subtitle} title={heading}
    onRefresh={actions.busy||garmin.busy?undefined:()=>{setRevision(v=>v+1);garmin.load()}} refreshing={detail.kind==='loading'}>
    {isCalendarDate(date)?<DayActions actions={actions} garmin={garmin} navigation={navigation} date={date} ready={detail.kind==='loaded'||detail.kind==='empty'}/>:null}
    {detail.kind === 'loading' ? <StatusPanel kind="loading" message="Loading your day…" /> : null}
    {detail.kind === 'empty' ? <StatusPanel kind="empty" message="No score saved for this day." /> : null}
    {detail.kind === 'offline' || detail.kind === 'error' ? <StatusPanel kind={detail.kind}
      message="Could not load this day's score breakdown. Previous data is not shown as live."
      retry={() => setRevision(v => v + 1)} /> : null}
    {data ? <DayScoreCard data={data} sources={{...coverage,...(garminLoaded?{garmin:true}:{})}} today={date===localToday()}/> : null}
    <GarminDayView state={garmin} showAction={false}/>
    {data ? <>
      <Card title="Activity">
        <View style={styles.metrics}>
          <Metric label="Steps" value={formatPoints(data.facts.steps)} />
          <Metric label="Running" value={formatDistance(data.facts.runM)} />
          <Metric label="Cycling" value={formatDistance(data.facts.bikeM)} />
          <Metric label="Swimming" value={formatDistance(data.facts.swimM)} />
          <Metric label="Workout points" value={formatPoints(data.facts.workoutPoints)} />
        </View>
      </Card>
      <Card title="Score breakdown">
        <Metric label="Breakdown total" value={formatPoints(data.score.ledgerTotal)} />
        {data.ledger.length ? data.ledger.map(entry => <TextLine key={entry.id}>
          {entry.name}{entry.type ? ' · ' + safeActivityType(entry.type) : ''}:
          {' ' + formatPoints(entry.points, true)} pt
        </TextLine>) : <Body subdued>No breakdown for this day.</Body>}
        <Body subdued>Imported and manually edited scores may differ from this breakdown.</Body>
      </Card>
    </> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, paddingVertical: 4 },
  value: { fontSize: 40, fontWeight: '800' },
  line: { fontSize: 14, lineHeight: 21 },
  listRow: { borderBottomWidth: 1, paddingVertical: 12, gap: 4, minHeight: 52 },
  rowTitle: { fontSize: 16, fontWeight: '700' },
  rowDetail: { fontSize: 14, lineHeight: 20 },
});
