import { describe, expect, it } from 'vitest';
import { ScoreBreakdownPanelComponent } from './score-breakdown-panel.component';
import type { DailyScoreBreakdown, ScoreBreakdownActivity, SourceRecordReference } from './score-breakdown.models';

const source: SourceRecordReference = {
  id: '10000000-0000-4000-8000-000000000001',
  rowHash: 'row-hash',
  sheetName: 'Sheet1',
  rowIndex: 2,
  batch: {
    id: '20000000-0000-4000-8000-000000000001',
    source: 'my_sport_xlsx',
    filename: 'my_sport.xlsx',
    originalSha256: 'file-hash',
    status: 'scored',
    startedAt: '2026-05-18T11:59:00.000Z',
    completedAt: '2026-05-18T12:00:00.000Z',
  },
};

const activity: ScoreBreakdownActivity = {
  id: '30000000-0000-4000-8000-000000000001',
  source: 'my_sport_xlsx',
  sourceActivityId: null,
  activityDate: '2026-05-18',
  startTime: null,
  activityType: 'run',
  subtype: 'outdoor',
  distanceM: 5_000,
  durationS: 1_200,
  movingTimeS: null,
  steps: null,
  calories: null,
  avgHr: null,
  maxHr: null,
  elevationGainM: null,
  avgSpeedMps: null,
  avgPaceSPerKm: null,
  effortPoints: null,
  notes: null,
  sourceRecord: source,
};

const breakdown: DailyScoreBreakdown = {
  date: '2026-05-18',
  recomputedAt: '2026-05-18T12:00:00.000Z',
  facts: { steps: 12_345, runM: 5_000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
  score: { appTotal: 25, excelTotal: 24, delta: 1, baseTotal: 20, bonusTotal: 5, ledgerTotal: 25 },
  sourceRecord: source,
  ledger: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      points: 20,
      reason: 'Run coefficient',
      calculation: { metricValue: 5, coefficient: 4 },
      createdAt: '2026-05-18T12:00:00.000Z',
      rule: null,
      activity,
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      points: 5,
      reason: 'Achievement bonus',
      calculation: { thresholdOperator: 'lt', thresholdValue: 1_500 },
      createdAt: '2026-05-18T12:00:01.000Z',
      rule: null,
      activity: null,
    },
  ],
};

describe('ScoreBreakdownPanelComponent', () => {
  it('distinguishes positive, negative, zero, and unavailable deltas', () => {
    const component = new ScoreBreakdownPanelComponent();

    expect([1, -1, 0, null].map((delta) => component.deltaKind(delta))).toEqual([
      'positive',
      'negative',
      'zero',
      'unavailable',
    ]);
    expect(component.deltaValue(4)).toBe('+4');
    expect(component.deltaValue(-4)).toBe('−4');
    expect(component.deltaValue(0)).toBe('0');
    expect(component.deltaValue(null)).toBe('Not available');
    expect(component.deltaDescription(null)).toContain('No spreadsheet total');
  });

  it('presents ledger inputs, activity values, and provenance without scoring', () => {
    const component = new ScoreBreakdownPanelComponent();

    expect(component.ledgerSum(breakdown)).toBe(25);
    expect(component.ledgerMatchesAppTotal(breakdown)).toBe(true);
    expect(component.calculationLabel(breakdown.ledger[0]!.calculation)).toBe('metric value: 5 · coefficient: 4');
    expect(component.activityLabel(activity)).toBe('run · outdoor · 5 km · 20:00');
    expect(component.sourceSummary(source)).toBe('my_sport.xlsx · Sheet1 row 2');
    expect(component.sourceSummary(null)).toBe('Source link unavailable');
  });

  it('supports loading, error, empty, and loaded component states', () => {
    const component = new ScoreBreakdownPanelComponent();

    component.state = 'loading';
    component.date = '2026-05-18';
    expect(component.state).toBe('loading');

    component.state = 'error';
    component.errorMessage = 'API unavailable';
    expect(component.errorMessage).toBe('API unavailable');

    component.state = 'loaded';
    component.breakdown = null;
    expect(component.breakdown).toBeNull();

    component.breakdown = { ...breakdown, score: { ...breakdown.score, excelTotal: null, delta: null } };
    expect(component.deltaKind(component.breakdown.score.delta)).toBe('unavailable');
  });
});
