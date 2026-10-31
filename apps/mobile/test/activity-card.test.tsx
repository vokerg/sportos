import React from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (value: unknown) => value } }));
vi.mock('../src/ui/theme', () => ({ useSportosTheme: () => ({ palette: {} }) }));
vi.mock('../src/ui/identity', () => ({ SportMark: 'SportMark' }));
import { ActivityCard } from '../src/activities/ActivityCard';
import type { Activity } from '../src/activities/contracts';
it('reuses canonical metrics and correction labels and forwards activity navigation', async () => {
  const activity = { id: 'activity', activity_date: '2026-10-31', start_time: null,
    activity_type: 'run', subtype: null, source: 'strava', distance_m: 5000,
    duration_s: 1800, moving_time_s: 1500, avg_pace_s_per_km: 300, avg_speed_mps: null,
    avg_hr: null, historicalSummary: false, distanceCorrection: { effectiveDistanceM: 5000, recordedDistanceM: 4800, revision: 1 },
  } as Activity;
  const onOpen = vi.fn();
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<ActivityCard activity={activity} onOpen={onOpen} />); });
  const content = JSON.stringify(tree.toJSON());
  expect(content).toContain('5.00 km');
  expect(content).toContain('Moving');
  expect(content).toContain('Corrected distance');
  expect(content).not.toContain('NaN');
  await act(async () => { tree.root.findByType('Pressable' as never).props.onPress(); });
  expect(onOpen).toHaveBeenCalledOnce();
  await act(async () => tree.unmount());
});
