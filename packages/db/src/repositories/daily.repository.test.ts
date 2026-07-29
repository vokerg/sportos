import { describe, expect, it } from 'vitest';
import {
  assembleDailyScoreBreakdown,
  type DailyScoreBreakdownHeaderRow,
  type DailyScoreBreakdownLedgerRow,
} from './daily.repository.js';

const header: DailyScoreBreakdownHeaderRow = {
  date: '2026-05-18',
  recomputedAt: new Date('2026-05-18T12:00:00.000Z'),
  steps: 12_345,
  runM: 13_000,
  bikeM: 35_000,
  swimM: 1_000,
  workoutPoints: 8,
  powerPoints: 7,
  baseTotal: 20,
  bonusTotal: 5,
  appTotal: 25,
  excelTotal: 24,
  sourceRecordId: '20000000-0000-4000-8000-000000000001',
  sourceRowHash: 'daily-row-hash',
  sourceSheetName: 'Sheet1',
  sourceRowIndex: 2,
  sourceBatchId: '30000000-0000-4000-8000-000000000001',
  sourceBatchSource: 'my_sport_xlsx',
  sourceBatchFilename: 'synthetic.xlsx',
  sourceBatchOriginalSha256: 'workbook-hash',
  sourceBatchStatus: 'scored',
  sourceBatchStartedAt: new Date('2026-05-18T11:59:00.000Z'),
  sourceBatchCompletedAt: new Date('2026-05-18T12:00:00.000Z'),
};

describe('assembleDailyScoreBreakdown', () => {
  it('returns totals, ordered entries, rules, activities, and provenance', () => {
    const rows = [
      ledgerRow({
        ledgerId: '40000000-0000-4000-8000-000000000001',
        ledgerPoints: 20,
        ledgerReason: 'Run coefficient',
        ruleId: '50000000-0000-4000-8000-000000000001',
        ruleCode: 'run.distance',
        ruleName: 'Run distance',
        ruleActivityType: 'run',
        ruleKind: 'coefficient',
        ruleMetric: 'distance_km',
        ruleCoefficient: 1.5,
        ruleValidFrom: '2026-01-01',
        rulePriority: 10,
        ruleEnabled: true,
        ruleCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        activityId: '60000000-0000-4000-8000-000000000001',
        activitySource: 'my_sport_xlsx',
        activityDate: '2026-05-18',
        activityType: 'run',
        activitySubtype: 'outdoor',
        activityDistanceM: 13_000,
        activitySourceRecordId: '70000000-0000-4000-8000-000000000001',
        activitySourceRowHash: 'activity-row-hash',
        activitySourceSheetName: 'Sheet1',
        activitySourceRowIndex: 2,
        activitySourceBatchId: '30000000-0000-4000-8000-000000000001',
        activitySourceBatchSource: 'my_sport_xlsx',
        activitySourceBatchFilename: 'synthetic.xlsx',
        activitySourceBatchOriginalSha256: 'workbook-hash',
        activitySourceBatchStatus: 'scored',
        activitySourceBatchStartedAt: new Date('2026-05-18T11:59:00.000Z'),
        activitySourceBatchCompletedAt: new Date('2026-05-18T12:00:00.000Z'),
      }),
      ledgerRow({
        ledgerId: '40000000-0000-4000-8000-000000000002',
        ledgerPoints: 5,
        ledgerReason: 'Achievement bonus',
      }),
    ];

    const result = assembleDailyScoreBreakdown(header, rows);

    expect(result.score).toEqual({
      appTotal: 25,
      excelTotal: 24,
      delta: 1,
      baseTotal: 20,
      bonusTotal: 5,
      ledgerTotal: 25,
    });
    expect(result.sourceRecord).toMatchObject({
      id: header.sourceRecordId,
      batch: { id: header.sourceBatchId, status: 'scored' },
    });
    expect(result.ledger.map((entry) => entry.id)).toEqual(rows.map((row) => row.ledgerId));
    expect(result.ledger[0]).toMatchObject({
      rule: { code: 'run.distance', coefficient: 1.5, priority: 10 },
      activity: {
        activityType: 'run',
        distanceM: 13_000,
        sourceRecord: { rowHash: 'activity-row-hash' },
      },
    });
    expect(result.ledger[1]?.rule).toBeNull();
    expect(result.ledger[1]?.activity).toBeNull();
  });

  it('returns null Excel delta and tolerates missing historical provenance', () => {
    const result = assembleDailyScoreBreakdown(
      {
        ...header,
        excelTotal: null,
        sourceRecordId: null,
        sourceRowHash: null,
        sourceBatchId: null,
        sourceBatchSource: null,
        sourceBatchStatus: null,
        sourceBatchStartedAt: null,
      },
      [ledgerRow({ ledgerPoints: 25 })],
    );

    expect(result.score.delta).toBeNull();
    expect(result.sourceRecord).toBeNull();
  });
});

function ledgerRow(overrides: Partial<DailyScoreBreakdownLedgerRow>): DailyScoreBreakdownLedgerRow {
  return {
    ledgerId: '40000000-0000-4000-8000-000000000099',
    ledgerPoints: 0,
    ledgerReason: 'Persisted contribution',
    ledgerCalculation: { metric: 'distance_km', value: 13 },
    ledgerCreatedAt: new Date('2026-05-18T12:00:00.000Z'),
    ruleId: null,
    ruleCode: null,
    ruleName: null,
    ruleActivityType: null,
    ruleKind: null,
    ruleMetric: null,
    ruleCoefficient: null,
    ruleThresholdOperator: null,
    ruleThresholdValue: null,
    ruleThresholdUnit: null,
    ruleConfiguredPoints: null,
    ruleValidFrom: null,
    ruleValidTo: null,
    rulePriority: null,
    ruleEnabled: null,
    ruleDescription: null,
    ruleCreatedAt: null,
    activityId: null,
    activitySource: null,
    activitySourceActivityId: null,
    activityDate: null,
    activityStartTime: null,
    activityType: null,
    activitySubtype: null,
    activityDistanceM: null,
    activityDurationS: null,
    activityMovingTimeS: null,
    activitySteps: null,
    activityCalories: null,
    activityAvgHr: null,
    activityMaxHr: null,
    activityElevationGainM: null,
    activityAvgSpeedMps: null,
    activityAvgPaceSPerKm: null,
    activityEffortPoints: null,
    activityNotes: null,
    activitySourceRecordId: null,
    activitySourceRowHash: null,
    activitySourceSheetName: null,
    activitySourceRowIndex: null,
    activitySourceBatchId: null,
    activitySourceBatchSource: null,
    activitySourceBatchFilename: null,
    activitySourceBatchOriginalSha256: null,
    activitySourceBatchStatus: null,
    activitySourceBatchStartedAt: null,
    activitySourceBatchCompletedAt: null,
    ...overrides,
  };
}
