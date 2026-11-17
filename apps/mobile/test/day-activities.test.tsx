import React, {useEffect} from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {afterEach, expect, it, vi} from 'vitest';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const {read} = vi.hoisted(() => ({read:vi.fn()}));
vi.mock('@react-navigation/native', () => ({useFocusEffect:(effect:() => void) => useEffect(effect, [effect])}));
vi.mock('../src/auth/useScreenSession', () => ({useScreenSession:() => ({read})}));
vi.mock('../src/activities/ActivityCard', () => ({ActivityCard:(props:object) => React.createElement('ActivityCard', props)}));
vi.mock('../src/ui/primitives', () => ({
  Card:(props:object) => React.createElement('Card', props),
  Body:(props:object) => React.createElement('Body', props),
  Action:(props:object) => React.createElement('Action', props),
  StatusPanel:(props:object) => React.createElement('StatusPanel', props),
}));
import {DayActivities} from '../src/daily/DayActivities';
const date = '2026-10-25'; // Date-only filtering must not shift with DST or UTC.
const row = (n:number, activityDate = date) => ({id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),
  activity_date:activityDate, activity_type:'run', source:'strava', distance_m:5000});
const page = (items:unknown[] = [], count = items.length, offset = 0) => ({items, summary:{count}, limit:25, offset});
const path = (offset = 0, day = date) => '/activities?from='+day+'&to='+day+'&limit=25&offset='+offset;
let tree:ReactTestRenderer|null = null;
const onOpen = vi.fn();
async function mount(day = date, revision = 0) {
  await act(async () => {tree = create(<DayActivities date={day} revision={revision} onOpen={onOpen}/>);});
}
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = null; vi.resetAllMocks();
});
it('reads exact-date canonical activities and opens the selected session without requiring scores', async () => {
  read.mockResolvedValue(page([row(1), {...row(2), activity_type:'walk'}]));
  await mount();
  expect(read).toHaveBeenCalledExactlyOnceWith(path());
  const cards = tree!.root.findAllByType('ActivityCard' as never);
  expect(cards).toHaveLength(2);
  expect(cards[1].props.activity.activity_type).toBe('walk');
  await act(async () => cards[1].props.onOpen());
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(row(2).id);
});
it('paginates with bounded reads and rejects repeated next taps while loading', async () => {
  read.mockResolvedValueOnce(page(Array.from({length:25}, (_, i) => row(i+1)), 26));
  await mount();
  let finish!:(value:unknown) => void;
  read.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const next = tree!.root.findByProps({title:'Next activities'});
  await act(async () => {next.props.onPress(); next.props.onPress();});
  expect(read.mock.calls.map(([p]) => p)).toEqual([path(), path(25)]);
  expect(tree!.root.findAllByType('ActivityCard' as never)).toHaveLength(0);
  await act(async () => finish(page([row(26)], 26, 25)));
  expect(tree!.root.findAllByType('ActivityCard' as never)).toHaveLength(1);
  expect(tree!.root.findAllByProps({title:'Next activities'})).toHaveLength(0);
  read.mockResolvedValue(page([row(1)], 26));
  await act(async () => tree!.root.findByProps({title:'Previous activities'}).props.onPress());
  expect(read.mock.calls.at(-1)![0]).toBe(path());
});
it('shows loading, isolates failures and retries with sanitized messages', async () => {
  let fail!:(error:Error) => void;
  read.mockImplementationOnce(() => new Promise((_resolve, reject) => {fail = reject;}));
  await mount();
  expect(tree!.root.findByType('StatusPanel' as never).props.kind).toBe('loading');
  await act(async () => fail(new Error('private provider error')));
  const status = tree!.root.findByType('StatusPanel' as never);
  expect(status.props.kind).toBe('error');
  expect(JSON.stringify(tree!.toJSON())).not.toContain('private provider error');
  read.mockResolvedValue(page());
  await act(async () => status.props.retry());
  expect(JSON.stringify(tree!.toJSON())).toContain('No activities recorded for this day.');
});
it('reloads on day refresh and ignores a late response from the previous date', async () => {
  let finish!:(value:unknown) => void;
  read.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  await mount();
  const tomorrow = '2026-10-26';
  read.mockResolvedValue(page([row(2, tomorrow)]));
  await act(async () => tree!.update(<DayActivities date={tomorrow} revision={0} onOpen={onOpen}/>));
  await act(async () => finish(page([row(1)])));
  expect(tree!.root.findByType('ActivityCard' as never).props.activity.id).toBe(row(2).id);
  await act(async () => tree!.update(<DayActivities date={tomorrow} revision={1} onOpen={onOpen}/>));
  expect(read.mock.calls.map(([p]) => p)).toEqual([path(), path(0, tomorrow), path(0, tomorrow)]);
});
it('rejects invalid dates and mismatched date or pagination responses', async () => {
  await mount('2026-02-30');
  expect(read).not.toHaveBeenCalled();
  read.mockResolvedValue(page([row(1, '2026-10-26')]));
  await act(async () => tree!.update(<DayActivities date={date} revision={0} onOpen={onOpen}/>));
  expect(tree!.root.findByType('StatusPanel' as never).props.kind).toBe('error');
  read.mockResolvedValue(page([row(1)], 2, 1));
  await act(async () => tree!.root.findByType('StatusPanel' as never).props.retry());
  expect(tree!.root.findAllByType('ActivityCard' as never)).toHaveLength(0);
});
