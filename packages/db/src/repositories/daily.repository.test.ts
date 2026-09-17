import { describe, expect, it } from 'vitest';
import {
  assembleDailyScoreBreakdown,
  assembleDailyEvidence,
  type DailyGarminObservationRow,
  type DailyScoreBreakdownHeaderRow,
  type DailyScoreBreakdownLedgerRow,
} from './daily.repository.js';

const header: DailyScoreBreakdownHeaderRow = {
  date: '2026-05-18',
  recomputedAt: new Date('2026-05-18T12:00:00.000Z'),
  scoreStatus: 'calculated',
  steps: 12_345,
  runM: 13_000,
  bikeM: 35_000,
  swimM: 1_000,
  workoutPoints: 8,
  baseTotal: 20,
  bonusPoints: 5,
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
      bonusPoints: 5,
      ledgerTotal: 25,
    });
    expect(result.scoreStatus).toBe('calculated');
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

  it('normalizes PostgreSQL decimal strings to JSON numbers', () => {
    const result = assembleDailyScoreBreakdown(
      {
        ...header,
        runM: '13000.00',
        bikeM: '35000.00',
        swimM: '0.00',
        excelTotal: '24.00',
      } as unknown as DailyScoreBreakdownHeaderRow,
      [ledgerRow({ ledgerPoints: 25 })],
      [ledgerRow({
        activityId: '60000000-0000-4000-8000-000000000001',
        activitySource: 'my_sport_xlsx',
        activityDate: '2026-05-18',
        activityType: 'run',
        activitySubtype: 'outdoor',
        activityDistanceM: '13000.00',
      } as unknown as Partial<DailyScoreBreakdownLedgerRow>)],
    );

    expect(result.facts).toMatchObject({ runM: 13_000, bikeM: 35_000, swimM: 0 });
    expect(result.score.excelTotal).toBe(24);
    expect(result.activities[0]?.distanceM).toBe(13_000);
    expect(typeof result.facts.swimM).toBe('number');
  });

  it('normalizes PostgreSQL date objects before returning the drawer contract', () => {
    const result = assembleDailyScoreBreakdown(
      { ...header, date: new Date('2026-05-18T00:00:00.000Z') } as unknown as DailyScoreBreakdownHeaderRow,
      [ledgerRow({
        ledgerPoints: 25,
        ruleId: '50000000-0000-4000-8000-000000000001',
        ruleCode: 'run.distance',
        ruleName: 'Run distance',
        ruleActivityType: 'run',
        ruleKind: 'coefficient',
        ruleMetric: 'distance_km',
        ruleValidFrom: new Date('2026-01-01T00:00:00.000Z') as unknown as string,
        rulePriority: 10,
        ruleEnabled: true,
        ruleCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        activityId: '60000000-0000-4000-8000-000000000001',
        activitySource: 'strava',
        activityDate: new Date('2026-05-18T00:00:00.000Z') as unknown as string,
        activityType: 'run',
      })],
    );

    expect(result.date).toBe('2026-05-18');
    expect(result.ledger[0]?.rule?.validFrom).toBe('2026-01-01');
    expect(result.ledger[0]?.activity?.activityDate).toBe('2026-05-18');
  });

  it('presents retained historical manual bonus ledgers with the unified terminology', () => {
    const result = assembleDailyScoreBreakdown(
      header,
      [ledgerRow({
        ledgerPoints: 25,
        ledgerReason: 'Power/extra-effort points: round(25 points × 1) = 25',
        ledgerCalculation: {
          activityType: 'power_bonus',
          powerPoints: 25,
          nested: ['power_bonus'],
        },
        ruleId: '50000000-0000-4000-8000-000000000001',
        ruleCode: 'power.manual',
        ruleName: 'Power/extra-effort points',
        ruleActivityType: 'bonus',
        ruleKind: 'manual_points',
        ruleMetric: 'effort_points',
        ruleValidFrom: '1900-01-01',
        rulePriority: 60,
        ruleEnabled: false,
        ruleCreatedAt: new Date('2023-01-01T00:00:00.000Z'),
      })],
    );

    expect(result.ledger[0]).toMatchObject({
      reason: 'Manual bonus points: round(25 points × 1) = 25',
      calculation: { activityType: 'bonus', bonusPoints: 25, nested: ['bonus'] },
      rule: { code: 'bonus.manual', name: 'Manual bonus points' },
    });
  });

  it('does not add stale manual distance to the source distance of a calculated day', () => {
    const stravaActivityId = '60000000-0000-4000-8000-000000000010';
    const result = assembleDailyScoreBreakdown(
      { ...header, runM: 9_946.6 },
      [ledgerRow({
        ledgerPoints: 16_909,
        activityId: stravaActivityId,
        activitySource: 'strava',
        activityDate: header.date,
        activityType: 'run',
        activitySubtype: 'outdoor',
        activityDistanceM: 9_946.6,
      })],
      [
        ledgerRow({
          activityId: '60000000-0000-4000-8000-000000000011',
          activitySource: 'manual',
          activityDate: header.date,
          activityType: 'run',
          activitySubtype: 'outdoor',
          activityDistanceM: 10_000,
        }),
        ledgerRow({
          activityId: stravaActivityId,
          activitySource: 'strava',
          activityDate: header.date,
          activityType: 'run',
          activitySubtype: 'outdoor',
          activityDistanceM: 9_946.6,
        }),
      ],
    );

    expect(result.facts).toMatchObject({ runM: 9_946.6, runOutdoorM: 9_946.6 });
    expect(result.activities).toHaveLength(2);
  });

  it('attaches current Garmin observations and their raw rows to the recorded date without changing facts or score', () => {
    const garmin = garminRow();
    const result = assembleDailyScoreBreakdown(
      header,
      [ledgerRow({ ledgerPoints: 25 })],
      [],
      [garmin],
    );

    expect(result.garminObservations).toEqual([expect.objectContaining({
      id: garmin.observationId,
      reportType: 'steps_weekly',
      recordedDate: header.date,
      values: { steps: 12_345 },
      sourceRecord: expect.objectContaining({ id: garmin.sourceRecordId }),
    })]);
    expect(result.sourceRecords).toContainEqual(expect.objectContaining({ id: garmin.sourceRecordId }));
    expect(result.facts.steps).toBe(header.steps);
    expect(result.score.appTotal).toBe(header.appTotal);
  });

  it('builds date evidence independently of a persisted daily score', () => {
    const evidence = assembleDailyEvidence('2026-05-18', [garminRow()]);

    expect(evidence.date).toBe('2026-05-18');
    expect(evidence.garminObservations).toHaveLength(1);
    expect(evidence.sourceRecords).toHaveLength(1);
  });
});

function garminRow(): DailyGarminObservationRow {
  return {
    observationId: '80000000-0000-4000-8000-000000000001',
    reportType: 'steps_weekly',
    recordedDate: '2026-05-18',
    recordedTime: null,
    values: { steps: 12_345 },
    sourceRecordId: '90000000-0000-4000-8000-000000000001',
    sourceRowHash: 'garmin-source-row-hash',
    sourceSheetName: 'steps_weekly',
    sourceRowIndex: 2,
    sourceStatus: 'normalized',
    sourceRawJson: { cells: ['18/05/2026', '12345'] },
    sourceErrors: [],
    sourceWarnings: [],
    sourceNormalizedEntityType: 'garmin_observation',
    sourceNormalizedEntityId: '80000000-0000-4000-8000-000000000001',
    sourceBatchId: 'a0000000-0000-4000-8000-000000000001',
    sourceBatchSource: 'garmin_csv',
    sourceBatchFilename: 'steps.csv',
    sourceBatchOriginalSha256: 'garmin-file-hash',
    sourceBatchStatus: 'normalized',
    sourceBatchStartedAt: new Date('2026-05-18T11:00:00.000Z'),
    sourceBatchCompletedAt: new Date('2026-05-18T11:00:01.000Z'),
  };
}

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
