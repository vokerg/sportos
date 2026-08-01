import { describe, expect, it } from 'vitest';
import {
  CANONICAL_EXPORT_SCHEMA_VERSION,
  CanonicalExportBundleSchema,
} from './canonical-export.js';

const availableProvenance = {
  status: 'available' as const,
  sourceRecordId: '11111111-1111-4111-8111-111111111111',
  sourceRecordHash: 'row-hash',
  importBatchId: '22222222-2222-4222-8222-222222222222',
  source: 'my_sport.xlsx:Daily',
  sheetName: 'Daily',
  rowIndex: 2,
  filename: 'my_sport.xlsx',
};

function bundle() {
  return {
    schemaVersion: CANONICAL_EXPORT_SCHEMA_VERSION,
    generatedAt: '2026-07-31T08:00:00.000Z',
    dateRange: { from: '2026-05-18', to: '2026-05-18' },
    rowCounts: { dailySummaries: 1, activities: 1, performanceEvents: 1 },
    dailySummaries: [{
      metricDate: '2026-05-18',
      steps: 1000,
      runM: 5000,
      bikeM: 0,
      swimM: 0,
      workoutPoints: 0,
      powerPoints: 0,
      basePoints: 5000,
      bonusPoints: 0,
      totalPoints: 5000,
      excelAllPoints: 5000,
      pointsDeltaVsExcel: 0,
      reconciliationStatus: 'exact' as const,
      avg10d: 4800,
      avg20d: null,
      avg30d: null,
      avg60d: null,
      avg365d: null,
      recomputedAt: '2026-07-31T08:00:00.000Z',
      provenance: availableProvenance,
    }],
    activities: [{
      id: '33333333-3333-4333-8333-333333333333',
      activityDate: '2026-05-18',
      startTime: null,
      activityType: 'run' as const,
      subtype: 'outdoor' as const,
      source: 'my_sport_xlsx' as const,
      sourceActivityId: null,
      distanceM: 5000,
      durationS: 1500,
      movingTimeS: 1490,
      steps: null,
      calories: null,
      avgHr: null,
      maxHr: null,
      elevationGainM: null,
      avgSpeedMps: null,
      avgPaceSPerKm: 300,
      effortPoints: null,
      notes: null,
      provenance: availableProvenance,
    }],
    performanceEvents: [{
      id: '44444444-4444-4444-8444-444444444444',
      activityId: '33333333-3333-4333-8333-333333333333',
      eventDate: '2026-05-18',
      source: 'run_db_xlsx' as const,
      distanceM: 5000,
      durationS: 1500,
      paceSPerKm: 300,
      isTreadmill: false,
      isRace: true,
      isPrMarker: true,
      sourceRank: 1,
      tags: ['race'],
      notes: null,
      provenance: {
        status: 'missing' as const,
        sourceRecordId: null,
        sourceRecordHash: null,
        importBatchId: null,
        source: 'run_db_xlsx',
        sheetName: null,
        rowIndex: null,
        filename: null,
      },
    }],
  };
}

describe('canonical export v1 contract', () => {
  it('accepts canonical rows and represents missing provenance explicitly', () => {
    const parsed = CanonicalExportBundleSchema.parse(bundle());
    expect(parsed.schemaVersion).toBe('sportos.canonical-export.v1');
    expect(parsed.performanceEvents[0]?.provenance.status).toBe('missing');
  });

  it('rejects available provenance without traceable identifiers', () => {
    const candidate = bundle();
    candidate.dailySummaries[0]!.provenance = { ...availableProvenance, sourceRecordId: null } as never;
    expect(() => CanonicalExportBundleSchema.parse(candidate)).toThrow(/source record id/i);
  });

  it('rejects missing provenance that claims traceable identifiers', () => {
    const candidate = bundle();
    candidate.performanceEvents[0]!.provenance = {
      ...candidate.performanceEvents[0]!.provenance,
      sourceRecordId: availableProvenance.sourceRecordId,
    } as never;
    expect(() => CanonicalExportBundleSchema.parse(candidate)).toThrow(/cannot claim traceable/i);
  });

  it('rejects mismatched declared row counts', () => {
    const candidate = bundle();
    candidate.rowCounts.activities = 2;
    expect(() => CanonicalExportBundleSchema.parse(candidate)).toThrow(/count does not match/i);
  });

  it('rejects hidden spreadsheet or raw payload fields', () => {
    const candidate = bundle() as ReturnType<typeof bundle> & { formula?: string };
    candidate.formula = '=SUM(A1:A2)';
    expect(() => CanonicalExportBundleSchema.parse(candidate)).toThrow(/unrecognized key/i);
  });

  it('rejects impossible and reversed export date ranges', () => {
    const impossible = bundle();
    impossible.dateRange = { from: '2026-02-30', to: '2026-05-18' };
    expect(() => CanonicalExportBundleSchema.parse(impossible)).toThrow(/real calendar date/i);

    const reversed = bundle();
    reversed.dateRange = { from: '2026-05-19', to: '2026-05-18' };
    expect(() => CanonicalExportBundleSchema.parse(reversed)).toThrow(/date range/i);
  });

  it('rejects rows outside the range and unstable ordering', () => {
    const outside = bundle();
    outside.dailySummaries[0]!.metricDate = '2026-05-17';
    expect(() => CanonicalExportBundleSchema.parse(outside)).toThrow(/outside the declared date range/i);

    const unordered = bundle();
    unordered.dateRange.to = '2026-05-19';
    unordered.activities = [
      { ...unordered.activities[0]!, id: '99999999-9999-4999-8999-999999999999', activityDate: '2026-05-19' },
      { ...unordered.activities[0]!, id: '11111111-1111-4111-8111-111111111111', activityDate: '2026-05-18' },
    ];
    unordered.rowCounts.activities = 2;
    expect(() => CanonicalExportBundleSchema.parse(unordered)).toThrow(/stable ascending order/i);
  });
});
