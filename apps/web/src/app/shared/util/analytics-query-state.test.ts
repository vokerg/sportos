import { describe, expect, it } from 'vitest';
import {
  boundedAllTimeRange,
  localCalendarDate,
  matchingQuickRange,
  quickRangeDates,
  readAnalyticsDateRange,
  readQueryCsv,
  readQueryNumberCsv,
} from './analytics-query-state';

describe('analytics query state', () => {
  it('uses local calendar fields instead of UTC serialization for quick ranges', () => {
    const localBoundary = {
      getFullYear: () => 2026,
      getMonth: () => 2,
      getDate: () => 31,
      toISOString: () => {
        throw new Error('UTC serialization must not be used for a local calendar date');
      },
    } as unknown as Date;

    expect(localCalendarDate(localBoundary)).toBe('2026-03-31');
    expect(quickRangeDates('1m', localBoundary)).toEqual({ from: '2026-02-28', to: '2026-03-31' });
  });

  it('matches presets from date-only strings without converting the URL date through UTC', () => {
    expect(matchingQuickRange('2026-01-01', '2026-03-31')).toBe('3m');
    expect(matchingQuickRange('2026-01-01', '2026-09-18')).toBe('ytd');
    expect(matchingQuickRange('2016-09-11', '2026-09-18')).toBe('all');
    expect(matchingQuickRange('2026-02-01', '2026-03-31')).toBe('custom');
  });

  it('normalizes malformed range params independently and keeps deep links deterministic', () => {
    const values: Record<string, string> = {
      from: '2026-02-30',
      to: '2026-09-18',
    };
    const query = { get: (name: string) => values[name] ?? null };

    expect(readAnalyticsDateRange(query, { from: '2025-09-18', to: '2026-09-18' })).toEqual({
      from: '2025-09-18',
      to: '2026-09-18',
      quickRange: '1y',
    });
  });

  it('keeps allowlisted csv query parsing bounded and duplicate-free', () => {
    const metrics = ['score', 'steps', 'run'] as const;
    expect(readQueryCsv('run,score', metrics, ['score'], 2)).toEqual(['run', 'score']);
    expect(readQueryCsv('run,run', metrics, ['score'], 2)).toEqual(['score']);
    expect(readQueryCsv('run,score,steps', metrics, ['score'], 2)).toEqual(['score']);

    const windows = [7, 20, 30, 60, 365] as const;
    expect(readQueryNumberCsv('30,365', windows, [30])).toEqual([30, 365]);
    expect(readQueryNumberCsv('30,30', windows, [30])).toEqual([30]);
    expect(readQueryNumberCsv('31', windows, [30])).toEqual([30]);
  });

  it('keeps the bounded all-time range inclusive', () => {
    expect(boundedAllTimeRange('2026-09-18')).toEqual({ from: '2016-09-11', to: '2026-09-18' });
  });
});
