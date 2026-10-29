import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { GarminDayCard } from './GarminDayCard';
import { ScoreHero } from './ScoreHero';
import { SportMark } from '../ui/identity';
import type { DailySummary, ActivityListPreview, MobileDayDetail } from './contracts';
import { contributionRows, dailySummaryPath, formatPoints, mergeDays, safeActivityType, scoreAuthority, scoreBreakdownPath, projectDetail, projectActivityPreview, parseDailySummaries } from './model.mjs';

type LoadKind = 'loading' | 'loaded' | 'empty' | 'error' | 'offline';
type HomeData = { days: DailySummary[]; activity: ActivityListPreview | null; activityError: boolean; activityLoading: boolean };
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
  return <Pressable accessibilityRole="button" accessibilityLabel={title + ', ' + detail}
    onPress={onPress} style={[styles.listRow, { borderColor: palette.border }]}>
    <View style={{flexDirection:'row',alignItems:'center',gap:12}}><Text style={[styles.rowTitle, { color: palette.text,flex:1 }]}>{title}</Text><Text style={{color:palette.muted,fontSize:22}} accessible={false}>›</Text></View>
    <Text style={[styles.rowDetail, { color: palette.muted }]}>{detail}</Text>
    {sources?<ProviderStatus sources={sources}/>:null}
  </Pressable>;
}
function Contributions({ row }: { row: DailySummary }) {
  const { palette } = useSportosTheme();
  const rows = contributionRows(row.score_contributions);
  return <Card title="Behind the score">
    {rows.length === 0 ? <Body subdued>Category attribution has not been reported for this day.</Body>
      : rows.map(item => <View key={item.key} style={{flexDirection:'row',alignItems:'center',gap:12}}>
        <SportMark sport={item.key} size={38}/>
        <Text style={{flex:1,color:palette.text,fontSize:14,fontWeight:'600'}}>{item.label}</Text>
        <Text style={{color:palette.text,fontSize:17,fontWeight:'700',fontVariant:['tabular-nums']}}>{formatPoints(item.points,true)} <Text style={{fontSize:11,color:palette.muted}}>pt</Text></Text>
      </View>)}
    <Body subdued>Unattributed points have no category breakdown.</Body>
  </Card>;
}

/** Latest persisted day, not a fabricated value for today when today's row is absent. */
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
        const days = parseDailySummaries(await read<unknown>(dailySummaryPath({ limit: 14, to: today })));
        if (!active) return;
        // Render official scores immediately; a slow activity query cannot delay the cockpit.
        setView({ kind: days.length ? 'loaded' : 'empty',
          data: { days, activity: null, activityError: false, activityLoading: true } });
        // Activities are a separate bounded canonical GET. Their failure must not hide official scores.
        let activity: ActivityListPreview | null = null;
        let activityError = false;
        try {
          activity = projectActivityPreview(await read<unknown>('/activities?from=' + shiftCalendarDate(today, -29)
            + '&to=' + today + '&limit=5&offset=0'));
        } catch {
          activityError = true;
        }
        if (active) setView({ kind: days.length ? 'loaded' : 'empty', data: { days, activity, activityError, activityLoading: false } });
      } catch (error) {
        if (active) setView({ kind: errorKind(error), data: null });
      }
    })();
    return () => { active = false; };
  }, [read, today, revision]));

  const retry = () => setRevision(v => v + 1);
  const latest = view.data?.days[0];
  return <Screen eyebrow="SPORTOS" title="Your day">
    {view.kind === 'loading' ? <StatusPanel kind="loading" message="Loading your day…" /> : null}
    {view.kind === 'offline' || view.kind === 'error' ? <StatusPanel kind={view.kind}
      message={view.kind === 'offline' ? 'Offline. No score is cached or presented as current.'
        : 'Could not load daily scores from SportOS.'} retry={retry} /> : null}
    {view.kind === 'empty' ? <StatusPanel kind="empty" message="No scores yet. Sync your activities to get started." retry={retry} /> : null}
    {latest ? <>
      <ScoreHero day={latest} today={today} onOpen={() =>
        navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('DailyDetail', { date: latest.metric_date })} />
      <Contributions row={latest} />
    </> : null}
    {view.data ? <Card title="Recent sessions">
      {view.data.activityLoading ? <StatusPanel kind="loading" message="Reading recent activity summary…" />
        : view.data.activityError ? <Body subdued>Activity recap is unavailable. Score data above remains valid.</Body>
        : view.data.activity?.summary.count === 0 ? <Body subdued>No activities in the last 30 days.</Body>
        : <>
          <TextLine>{view.data.activity?.summary.count ?? 0} activities · last 30 days</TextLine>
          {(view.data.activity?.items ?? []).map(a =>
            <CompactRow key={a.id} title={a.activity_date + ' · ' + safeActivityType(a.activity_type)}
              detail={(a.distance_m !== null ? formatDistance(a.distance_m) + ' · ' : '') + sourceLabel(a.source)}
              onPress={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('ActivityDetail', { activityId: a.id })} />)}
        </>}
      <Action title="Open Activities" secondary onPress={() => navigation.navigate('Activities')} />
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
  const [selected, setSelected] = useState<Load<DailySummary>>({ kind: 'loading', data: null });
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

  useEffect(() => {
    if (history.kind === 'loading' || history.kind === 'error' || history.kind === 'offline') {
      setSelected({ kind: history.kind === 'loading' ? 'loading' : history.kind, data: null });
      return;
    }
    const found = history.data?.find(row => row.metric_date === date);
    if (found) {
      setSelected({ kind: 'loaded', data: found });
      return;
    }
    let active = true;
    setSelected({ kind: 'loading', data: null });
    void read<unknown>(dailySummaryPath({ from: date, to: date, limit: 1 }))
      .then(payload => {
        const rows = parseDailySummaries(payload);
        if (active) setSelected({ kind: rows.length ? 'loaded' : 'empty', data: rows[0] ?? null });
      })
      .catch(error => {
        if (active) setSelected({ kind: errorKind(error), data: null });
      });
    return () => { active = false; };
  }, [date, history, read]);

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

  return <Screen eyebrow="ONE DAY AT A TIME" title="Daily journal">
    <Card title="Choose day">
      <DateStepper date={date} onChange={setDate} />
      <Action title="Jump to today" secondary disabled={date === today} onPress={() => setDate(localToday())} />
      {selected.kind === 'loading' ? <StatusPanel kind="loading" message="Checking the saved day…" /> : null}
      {selected.kind === 'empty' ? <StatusPanel kind="empty" message="No score saved for this day." /> : null}
      {selected.kind === 'offline' || selected.kind === 'error' ?
        <StatusPanel kind={selected.kind} message="Could not load this day."
          retry={() => setRevision(v => v + 1)} /> : null}
      {selected.data ? <>
        <Metric label="Official score" value={formatPoints(selected.data.total_points)}
          source={scoreAuthority(selected.data.score_status)} />
        <TextLine>{selected.data.metric_date === today ? 'Today is incomplete.' : 'Persisted score for the selected day.'}</TextLine>
        <ProviderStatus sources={selected.data.providerSources}/>
        <View style={styles.metrics}>
          <Metric label="Steps" value={formatPoints(selected.data.steps)} />
          <Metric label="Run" value={formatDistance(selected.data.run_m)} />
          <Metric label="Bike" value={formatDistance(selected.data.bike_m)} />
          <Metric label="Swim" value={formatDistance(selected.data.swim_m)} />
          <Metric label="Workout points" value={formatPoints(selected.data.workout_points)} />
          <Metric label="Bonus" value={formatPoints(selected.data.bonus_points, true)} />
        </View>
        <Action title="Open score detail" onPress={() =>
          navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('DailyDetail', { date: selected.data!.metric_date })} />
      </> : null}
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
          onPress={() => setDate(row.metric_date)} />)}
      {olderError ? <Body subdued>Older records could not be loaded; retry when connected.</Body> : null}
      {hasOlder && history.kind === 'loaded' ?
        <Action title={loadingOlder ? 'Loading older days…' : 'Load older days'} secondary
          disabled={loadingOlder} onPress={loadOlder} /> : null}
      {history.kind === 'loaded' ? <Action title="Refresh history" secondary
        onPress={() => setRevision(v => v + 1)} /> : null}
    </Card>
  </Screen>;
}

export function DailyDetailScreen({ route }: NativeStackScreenProps<RootStack, 'DailyDetail'>) {
  const { read } = useSession();
  const date = route.params.date;
  const [revision, setRevision] = useState(0);
  const [coverage,setCoverage]=useState<{strava?:boolean;garmin?:boolean}>();
  const [garminLoaded,setGarminLoaded]=useState(false);
  const onGarminLoaded=useCallback((hasData:boolean)=>setGarminLoaded(hasData),[]);
  const [detail, setDetail] = useState<Load<MobileDayDetail>>(INITIAL);
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
  return <Screen nested eyebrow="DAILY" title={date}>
    {detail.kind === 'loading' ? <StatusPanel kind="loading" message="Loading your day…" /> : null}
    {detail.kind === 'empty' ? <StatusPanel kind="empty" message="No score saved for this day." /> : null}
    {detail.kind === 'offline' || detail.kind === 'error' ? <StatusPanel kind={detail.kind}
      message="Could not load this day's score breakdown. Previous data is not shown as live."
      retry={() => setRevision(v => v + 1)} /> : null}
    {data ? <>
      <Card title="Daily score">
        <ProviderStatus sources={{...coverage,...(garminLoaded?{garmin:true}:{})}}/>
        <Metric label="Total points" value={formatPoints(data.score.appTotal)}
          source={scoreAuthority(data.status)} />
        <TextLine>{data.date === localToday()
          ? 'Today so far.' : 'Saved score.'}</TextLine>
        <View style={styles.metrics}>
          <Metric label="Base" value={formatPoints(data.score.baseTotal)} />
          <Metric label="Bonus" value={formatPoints(data.score.bonusPoints, true)} />
          {data.score.excelTotal !== null ?
            <Metric label="Original Excel total" value={formatPoints(data.score.excelTotal)} /> : null}
          {data.score.delta !== null ?
            <Metric label="Difference vs Excel" value={formatPoints(data.score.delta, true)} /> : null}
        </View>
        
      </Card>
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
      <Action title="Refresh this day" secondary onPress={() => setRevision(v => v + 1)} />
    </> : null}
    <GarminDayCard key={date} date={date} onLoaded={onGarminLoaded}/>
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
