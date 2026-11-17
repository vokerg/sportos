import React, {useCallback, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {MobileApiError} from '../../../../packages/shared/src/mobile-api';
import {ActivityCard, projectActivityList, type ActivityList} from '../activities';
import {useScreenSession} from '../auth/useScreenSession';
import {Action, Body, Card, StatusPanel} from '../ui/primitives';
import {isCalendarDate} from '../ui/format.mjs';

const PAGE_SIZE = 25;
type View = {kind:'loading'|'loaded'|'empty'|'error'|'offline'; data:ActivityList|null};

/** Canonical sessions are independent of saved daily scores and retained Garmin evidence. */
export function DayActivities({date, revision, onOpen}: {
  date:string; revision:number; onOpen(activityId:string):void;
}) {
  const {read} = useScreenSession();
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<View>({kind:'loading', data:null});

  useFocusEffect(useCallback(() => {
    let active = true;
    setView({kind:'loading', data:null});
    if (!isCalendarDate(date)) {
      setView({kind:'error', data:null});
      return () => {active = false;};
    }
    void read<unknown>('/activities?from='+date+'&to='+date+'&limit='+PAGE_SIZE+'&offset='+offset)
      .then(projectActivityList)
      .then(data => {
        if (!active) return;
        if (data.offset !== offset || data.items.some(row => row.activity_date !== date)) {
          throw new Error('Inconsistent day activities');
        }
        setView({kind:data.items.length ? 'loaded' : 'empty', data});
      })
      .catch(error => {
        if (active) setView({kind:error instanceof MobileApiError && error.kind === 'network' ? 'offline' : 'error', data:null});
      });
    return () => {active = false;};
  }, [date, read, offset, revision, retry]));

  const data = view.data;
  const next = offset + (data?.items.length ?? 0);
  return <Card title="Activities">
    {view.kind === 'loading' ? <StatusPanel kind="loading" message="Loading this day's activities…"/> : null}
    {view.kind === 'error' || view.kind === 'offline' ? <StatusPanel kind={view.kind}
      message="Could not load this day's activities." retry={() => setRetry(value => value + 1)}/> : null}
    {view.kind === 'empty' ? <Body subdued>No activities recorded for this day.</Body> : null}
    {data?.items.length ? <Body subdued>{offset + 1}–{next} of {data.count} activities</Body> : null}
    {data?.items.map(activity => <ActivityCard key={activity.id} activity={activity}
      onOpen={() => onOpen(activity.id)}/>)}
    {offset > 0 ? <Action title="Previous activities" secondary onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))}/> : null}
    {data && data.items.length > 0 && next < data.count && next <= 100000 ?
      <Action title="Next activities" secondary onPress={() => setOffset(next)}/> : null}
  </Card>;
}
