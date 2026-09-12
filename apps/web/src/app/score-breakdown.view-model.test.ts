import { describe, expect, it } from 'vitest';
import type {
  DailyScoreBreakdown,
  ScoreBreakdownActivity,
  SourceRecordReference,
} from './score-breakdown.models';
import {
  activityLabel,
  activityScoreLabel,
  calculationLabel,
  deltaDescription,
  deltaKind,
  deltaValue,
  formatDistance,
  formatNumber,
  formatSigned,
  importedEquationLabel,
  importedLedgerDetails,
  ledgerMatchesAppTotal,
  ledgerSum,
  scoreAuthorityNote,
  scoreStatusLabel,
  sourceRecordTitle,
  sourceSummary,
} from './score-breakdown.view-model';

const source: SourceRecordReference = {
  id: '10000000-0000-4000-8000-000000000001',
  rowHash: 'row-hash',
  sheetName: 'Sheet1',
  rowIndex: 2,
  status: 'normalized',
  rawJson: { headers: ['Date'], cells: [46130] },
  errors: [],
  warnings: [],
  normalizedEntityType: 'daily_metric',
  normalizedEntityId: '2026-05-18',
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
  scoreStatus: 'calculated',
  facts: { steps: 1234, runM: 5000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
  score: { appTotal: 25, excelTotal: 24, delta: 1, baseTotal: 20, bonusTotal: 5, ledgerTotal: 25 },
  sourceRecord: source,
  activities: [activity],
  sourceRecords: [source],
  ledger: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      points: 20,
      reason: 'Base',
      calculation: { metricValue: 5, coefficient: 4 },
      createdAt: '2026-05-18T12:00:00.000Z',
      rule: null,
      activity,
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      points: 5,
      reason: 'Bonus',
      calculation: {},
      createdAt: '2026-05-18T12:00:01.000Z',
      rule: null,
      activity: null,
    },
  ],
};

describe('score breakdown view model', () => {
  it('derives delta presentation without changing score values', () => {
    expect([1, -1, 0, null].map(deltaKind)).toEqual(['positive', 'negative', 'zero', 'unavailable']);
    expect(deltaValue(4)).toBe('+4');
    expect(deltaValue(-4)).toBe('−4');
    expect(deltaValue(0)).toBe('0');
    expect(deltaValue(null)).toBe('Not available');
    expect(deltaDescription(null)).toBe('No spreadsheet total was imported');
  });

  it('describes imported, manual, and calculated authority states explicitly', () => {
    expect(scoreStatusLabel('imported')).toBe('Imported ledger');
    expect(scoreStatusLabel('manual')).toBe('Manual edit');
    expect(scoreStatusLabel('calculated')).toBe('Calculated');
    expect(scoreAuthorityNote('imported')).toContain('authoritative');
    expect(scoreAuthorityNote('manual')).toContain('authoritative');
    expect(scoreAuthorityNote('calculated')).toContain('canonical activities');
  });

  it('formats calculated ledger and activity presentation without scoring', () => {
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatDistance(5000)).toBe('5 km');
    expect(formatDistance(null)).toBe('—');
    expect(formatSigned(5)).toBe('+5');
    expect(formatSigned(-5)).toBe('−5');
    expect(ledgerSum(breakdown)).toBe(25);
    expect(ledgerMatchesAppTotal(breakdown)).toBe(true);
    expect(ledgerMatchesAppTotal({ ...breakdown, score: { ...breakdown.score, appTotal: 26 } })).toBe(false);
    expect(calculationLabel(breakdown.ledger[0]!.calculation)).toBe('metric value: 5 · coefficient: 4');
    expect(activityLabel(activity)).toBe('run · outdoor · 5 km · 20:00');
    expect(activityScoreLabel(activity, breakdown)).toBe('In ledger');
  });

  it('keeps missing provenance explicit rather than guessing a source', () => {
    expect(sourceSummary(null)).toBe('Source link unavailable');
    expect(sourceSummary(source)).toBe('my_sport.xlsx · Sheet1 row 2');
    expect(sourceRecordTitle(source)).toBe('my_sport.xlsx · Sheet1 row 2');
  });

  it('explains an imported workbook total from retained cached source values', () => {
    const importedSource: SourceRecordReference = {
      ...source,
      rawJson: {
        headers: ['Date', 'Steps', 'Run to S', 'Bike to S', 'WOtotal', 'Pow', 'All'],
        cells: [46130, 1000, 2000, 2991, 4, 5, 6000],
      },
    };
    const importedBreakdown: DailyScoreBreakdown = {
      ...breakdown,
      scoreStatus: 'imported',
      sourceRecord: importedSource,
      score: { appTotal: 6000, excelTotal: 6000, delta: 0, baseTotal: 6000, bonusTotal: 0, ledgerTotal: 6000 },
      ledger: [{
        id: '40000000-0000-4000-8000-000000000003',
        points: 6000,
        reason: 'Imported workbook ledger total',
        calculation: { scoreStatus: 'imported', source: 'my_sport_xlsx', field: 'All', importedPoints: 6000 },
        createdAt: '2026-05-18T12:00:00.000Z',
        rule: null,
        activity: null,
      }],
    };

    const details = importedLedgerDetails(importedBreakdown.ledger[0]!, importedBreakdown);

    expect(details).toMatchObject({
      formula: null,
      showEquation: true,
      inputTotal: 6000,
      matchesTotal: true,
    });
    expect(details?.inputs.map((input) => [input.label, input.value])).toEqual([
      ['Steps', 1000],
      ['Run to S', 2000],
      ['Bike to S', 2991],
      ['WOtotal', 4],
      ['Pow', 5],
    ]);
    expect(importedEquationLabel(details!, 6000)).toContain('Available cached workbook values');
  });
});
