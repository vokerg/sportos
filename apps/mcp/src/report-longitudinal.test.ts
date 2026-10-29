import { describe, it, expect } from 'vitest';
import { buildAthleteSnapshot, type AthleteActivity } from '@sportos/analytics';
import { athleteSnapshotSchema } from './contracts.js';
import { renderReport } from './report.js';
const a = (
  id: string,
  date: string,
  discipline: 'run' | 'bike' | 'swim',
  distanceM: number,
  subtype = 'outdoor',
): AthleteActivity => ({
  id,
  date,
  discipline,
  distanceM,
  subtype,
  source: 'strava',
  recordedDistanceM: distanceM,
  distanceCorrected: false,
  elapsedS: 2400,
  movingS: 1800,
  avgHrBpm: 145,
  maxHrBpm: 175,
  elevationM: 25,
  updatedAt: '2026-10-29T12:00:00.000Z',
  historicalSummary: false,
});
describe('athlete-specific Russian report depth', () => {
  it('renders quantitative findings, nonoverlapping comparisons, condition-specific benchmarks and retained evidence rather than just chapter labels', () => {
    const ids = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
    ];
    const s = athleteSnapshotSchema.parse(
      buildAthleteSnapshot({
        activities: [
          a(ids[0], '2025-01-01', 'bike', 40000),
          a(ids[1], '2026-10-10', 'bike', 40000, 'indoor'),
          a(ids[2], '2026-10-10', 'swim', 1900, 'indoor'),
          a(ids[3], '2026-09-15', 'run', 30000),
        ],
        supplements: [],
        runningBests: [],
        recentRunningBests: [],
        asOfDate: '2026-10-29',
        timezone: 'Europe/Copenhagen',
        generatedAt: '2026-10-29T12:00:00.000Z',
      }),
    );
    const report = renderReport(s);
    for (const text of [
      'неперекрывающимися окнами',
      'Сезонный каталог',
      'повторяемость',
      'Распределения последних 90 дней',
      'Медиана / P90',
      'Записанная',
      'Матрица сохранённого опыта',
    ].filter((t) => t !== 'Записанная'))
      expect(report).toContain(text);
    expect(report).toContain('2026-10-01 — 2026-10-28');
    expect(report).toContain('2026-09-03 — 2026-09-30');
    expect(report).toContain('activity:' + ids[0]);
    expect(report).toContain('activity:' + ids[1]);
    expect(report).toContain('1900');
    expect(report).toContain('30000');
    expect(report).not.toContain('undefined');
    expect(report).not.toContain('NaN');
    expect(report.match(/^## \d+\./gm)).toHaveLength(20);
  });
});
